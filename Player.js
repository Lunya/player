const winston = require('winston');
const Nightmare = require('nightmare');
const amqp = require('amqplib');
const MongoClient = require('mongodb').MongoClient;
const ObjectID = require('mongodb').ObjectID;
const wat_action = require('wat_action_nightmare');
const QUEUE_NAME = 'wat_queue';

function Player (serverNames) {
	this.dbUrl = `mongodb://${serverNames.mongoServerName}:27017/wat_storage`;
	this.rmqUrl = `amqp://${serverNames.rabbitServerName}`;
	winston.info(`New Player (${this.dbUrl}) (${this.rmqUrl})`);

	this.start = start;
}

	


function start() {
	winston.info('Player Started');
	amqp.connect(this.rmqUrl)
		.then(conn => {
			winston.info('connected');
			this.connection = conn;
			return conn.createConfirmChannel();
		})
		.then(ch => {
			winston.info('channel created');
			this.ch = ch;
			this.ch.assertQueue(QUEUE_NAME, { durable: true });
			winston.info('Queue Created');
			this.ch.prefetch(1);
			this.ch.consume(QUEUE_NAME, scenarioMsg => {
				if (scenarioMsg !== null) {
					playScenario.call(this, scenarioMsg);
				}
			});
		})
		.catch(err => {
			winston.info(err);
			setTimeout(() => {
				this.start(); 
			}, 2000);
		});
}

function playScenario(scenarioMsg) {
	const scenarioContent = JSON.parse(scenarioMsg.content.toString());
	winston.info(`Player Begins To Play A Scenario : ${scenarioContent._id}`);
	const actions = scenarioContent.actions;
	const scenario = new wat_action.Scenario(actions);
	if (scenarioContent.wait && Number(scenarioContent.wait) !== 0) {
		scenario.addOrUpdateWait(Number(scenarioContent.wait));
		winston.info(`Wait = ${scenarioContent.wait}`);
	} else {
		winston.info('no wait after each action');
	}
	winston.info(scenario.toString());
	const browser = new Nightmare({show:false, loadTimeout: 10000 , gotoTimeout: 10000, switches:{'ignore-certificate-errors': true}});
	scenario.attachTo(browser)
		.then(() => {
			winston.info('Scenario Success');
			recordSuccessfulRun.call(this, scenarioMsg);
			browser.end().then();
		})
		.catch((e) => {
			winston.info('Scenario Error');
			winston.info(e);
			recordErrorRun.call(this, scenarioMsg, e);
		});
}

function recordSuccessfulRun(scenarioMsg) {
	winston.info('Record Successful Run');
	var sid = JSON.parse(scenarioMsg.content.toString())._id;
	MongoClient.connect(this.dbUrl)
		.then(db => {
			db.collection('run', (err, runCollection) => {
				if (err) {
					winston.error(err);
				} else {
					var newRun = {};
					newRun.sid = new ObjectID(sid);
					newRun.isSuccess = true;
					newRun.date = new Date().toJSON();//.slice(0,10).replace(/-/g,'/');
					newRun._id = ObjectID();  
					runCollection.save(newRun)
						.then(() => {
							winston.info('Successful Run Has Been Saved');
							this.ch.ack(scenarioMsg);
						}).catch(err => {
							winston.error(err);
						});
				}
			});
		}).catch(err => {
			winston.error(err);
		});
}

function recordErrorRun(scenarioMsg, error) {
	var sid = JSON.parse(scenarioMsg.content.toString())._id;
	winston.info(`Record Error Run of scenario ${sid}`);
	MongoClient.connect(this.dbUrl)
		.then(db => {
			db.collection('run', (err, runCollection) => {
				if (err) {
					winston.error(err);
				} else {
					var newRun = {};
					newRun.sid = new ObjectID(sid);
					newRun.isSuccess = false;
					newRun.error = error;
					newRun.date = new Date().toJSON();//.slice(0,10).replace(/-/g,'/');
					newRun._id = ObjectID();  
					runCollection.save(newRun)
						.then( () => {
							winston.info('Error Run Has Been Saved');
							this.ch.ack(scenarioMsg);
						}).catch(err => {
							winston.error(err);
						});
				}
			});
		}).catch(err => {
			winston.error(err);
		});
}


module.exports.Player = Player;