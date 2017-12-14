'use strict';

var constants = require('../helpers/constants.js');
var sql = require('../sql/frogings.js');
var slots = require('../helpers/slots.js');
var config = require('../config.json');
var request = require('request');
var async = require('async');

// Private fields
var __private = {};
__private.types = {};

// Private fields
var modules, library, self;

// Constructor
function Frozen(logger, db, transaction, cb) {
	self = this;
	self.scope = {
		logger: logger,
		db: db,
		logic: {
			transaction: transaction
		}
	};
	
	if (cb) {
		return setImmediate(cb, null, this);
	}
}


Frozen.prototype.create = function (data, trs) {
	trs.startTime = trs.timestamp;
	var date = new Date(trs.timestamp * 1000);
	trs.nextMilestone = (date.setMinutes(date.getMinutes() + constants.froze.milestone))/1000;
	trs.endTime = (date.setMinutes(date.getMinutes() - constants.froze.milestone + constants.froze.endTime))/1000;
	trs.recipientId = null;
	trs.freezedAmount = data.freezedAmount;
	return trs;
};

Frozen.prototype.ready = function (frz, sender) {
	return true;
};

//Hotam Singh
Frozen.prototype.dbTable = 'stake_orders';

Frozen.prototype.dbFields = [
	"id",
	"status",
	"startTime",
	"nextMilestone",
	"endTime",
	"senderId",
	"recipientId",
	"freezedAmount" 
];

Frozen.prototype.inactive= '0';
Frozen.prototype.active= '1';

Frozen.prototype.dbSave = function (trs) {
	//Hotam Singh
	return {
		table: this.dbTable,
		fields: this.dbFields,
		values: {
			id: trs.id,
			status: this.active,
			startTime: trs.startTime,
			nextMilestone: trs.nextMilestone,
			endTime : trs.endTime,
			senderId: trs.senderId,
			recipientId: trs.recipientId,
			freezedAmount: trs.freezedAmount
		}
	};
};

Frozen.prototype.dbRead = function (raw) {
	return null;
};

Frozen.prototype.objectNormalize = function (trs) {
	delete trs.blockId;
	return trs;
};

Frozen.prototype.undoUnconfirmed = function (trs, sender, cb) {
	return setImmediate(cb);
};

Frozen.prototype.applyUnconfirmed = function (trs, sender, cb) {
	return setImmediate(cb);
};

Frozen.prototype.undo = function (trs, block, sender, cb) {
	modules.accounts.setAccountAndGet({address: trs.recipientId}, function (err, recipient) {
		if (err) {
			return setImmediate(cb, err);
		}

		modules.accounts.mergeAccountAndGet({
			address: trs.recipientId,
			balance: -trs.amount,
			u_balance: -trs.amount,
			blockId: block.id,
			round: modules.rounds.calc(block.height)
		}, function (err) {
			return setImmediate(cb, err);
		});
	});
};

Frozen.prototype.apply = function (trs, block, sender, cb) {
	// var data = {
	// 	address: sender.address
	// };

	// modules.accounts.setAccountAndGet(data, cb);
	return setImmediate(cb, null, trs);
};

Frozen.prototype.getBytes = function (trs) {
	return null;
};

Frozen.prototype.process = function (trs, sender, cb) {
	return setImmediate(cb, null, trs);
};

Frozen.prototype.verify = function (trs, sender, cb) {
/*
  if (!trs.recipientId) {
		return setImmediate(cb, 'Missing recipient');
	}
*/
	if (trs.amount < 0) {
		return setImmediate(cb, 'Invalid transaction amount');
	}

	return setImmediate(cb, null, trs);
};

Frozen.prototype.calculateFee = function (trs, sender) {
	return constants.fees.froze;
};

Frozen.prototype.bind = function (accounts, rounds) {
	modules = {
		accounts: accounts,
		rounds: rounds,
	};
};

Frozen.prototype.checkFrozeOrders = function () {

	var i, currentTime = slots.getTime();
	var totalMilestone = constants.froze.endTime / constants.froze.milestone;

	self.scope.db.query(sql.frozeBenefit,
		{
			milestone: constants.froze.milestone * 60,
			currentTime: currentTime
		}).then(function (rows) {
			self.scope.logger.info("Successfully get :" + rows.length +", number of froze order");

			if (rows.length > 0) {
				//Update nextMilesone in "stake_orders" table
				self.scope.db.none(sql.checkAndUpdateMilestone,
					{
						milestone: constants.froze.milestone * 60,
						currentTime: currentTime
					}).then(function () {
						console.log("Successfully check milestones");

						//change status and nextmilestone
						self.scope.db.none(sql.disableFrozeOrders,
							{
								currentTime: currentTime,
								totalMilestone: totalMilestone
							}).then(function () {
								console.log("Successfully check status for disable froze orders");

							}).catch(function (err) {
								self.scope.logger.error(err.stack);
							});

					}).catch(function (err) {
						self.scope.logger.error(err.stack);
					});
			}

			for (i = 0; i < rows.length; i++) {

				if (rows[i].nextMilestone === rows[i].endTime) {
					self.scope.db.none(sql.deductFrozeAmount, {
						FrozeAmount: rows[i].freezedAmount,
						senderId: rows[i].senderId
					}).then(function () {
						self.scope.logger.info("Successfully check and if applicable, deduct froze amount from mem_account table");

					}).catch(function (err) {
						self.scope.logger.error(err.stack);
					});
				}

				//Request to send tarnsaction
				var transactionData = {
					json: {
						secret: config.users[0].secret,
						amount: parseInt(rows[i].freezedAmount * 0.1),
						recipientId: rows[i].senderId,
						publicKey: config.users[0].publicKey
					}
				};
				//Send froze monthly rewards to users
				self.scope.logic.transaction.sendTransaction(transactionData);
			}

		}).catch(function (err) {
			self.scope.logger.error(err.stack);
		});

};

// Export
module.exports = Frozen;