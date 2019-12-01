odoo.define('pos_retail.pos_backend', function (require) {
    "use strict";

    var WebClient = require('web.WebClient');
    var core = require('web.core');
    var _t = core._t;
    var Backbone = window.Backbone;
    var bus = require('pos_retail.core_bus');
    var rpc = require('web.rpc');
    var exports = {};

    var indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB || window.shimIndexedDB;

    if (!indexedDB) {
        window.alert("Your browser doesn't support a stable version of IndexedDB.")
    }

    exports.auto_drop_database = Backbone.Model.extend({
        initialize: function (web_client) {
            this.web_client = web_client;
        },
        start: function () {
            this.bus = bus.bus;
            this.bus.on("notification", this, this.on_notification);
            this.bus.start_polling();
        },
        on_notification: function (notifications) {
            var self = this;
            if (notifications && notifications[0] && notifications[0][1]) {
                for (var i = 0; i < notifications.length; i++) {
                    var channel = notifications[i][0][1];
                    if (channel == 'pos.remote_sessions') {
                        var data = JSON.parse(notifications[i][1]);
                        if (data['message']) {
                            this.web_client.do_notify(_t('Alert'),
                                _t(data['message']));
                        }
                        if (data['open_session']) {
                            window.open('/pos/web', '_self');
                        }
                        if (data['remove_cache']) {
                            this.web_client.remove_indexed_db();
                        }
                        if (data['validate_and_post_entries']) {
                            return rpc.query({
                                model: 'pos.config',
                                method: 'validate_and_post_entries_session',
                                args: [[data['config_id']]],
                                context: {}
                            }).then(function () {
                                self.web_client.do_notify(_t('Alert'),
                                    _t('Your pos session just validated and post entries by your manager'));
                            })
                        }
                    }
                }
            }
        }
    });

    WebClient.include({
        init_db: function (table_name, sequence) {
            var status = new $.Deferred();
            var session = this.getSession();
            var db = session.db
            var request = indexedDB.open(db + '_' + sequence, 1);
            request.onerror = function (ev) {
                status.reject(ev);
            };
            request.onupgradeneeded = function (ev) {
                var db = ev.target.result;
                var os_product = db.createObjectStore('product.product', {keyPath: "id"});
                os_product.createIndex('bc_index', 'barcode', {unique: false})
                os_product.createIndex('dc_index', 'default_code', {unique: false})
                os_product.createIndex('name_index', 'name', {unique: false})
                db.createObjectStore('res.partner', {keyPath: "id"});
                db.createObjectStore('account.invoice', {keyPath: "id"});
                db.createObjectStore('account.invoice.line', {keyPath: "id"});
                db.createObjectStore('pos.category', {keyPath: "id"});
                db.createObjectStore('pos.order', {keyPath: "id"});
                db.createObjectStore('pos.order.line', {keyPath: "id"});
                db.createObjectStore('sale.order', {keyPath: "id"});
                db.createObjectStore('sale.order.line', {keyPath: "id"});
            };
            request.onsuccess = function (ev) {
                var db = ev.target.result;
                var transaction = db.transaction([table_name], "readwrite");
                transaction.oncomplete = function () {
                    db.close();
                };
                if (!transaction) {
                    status.reject(new Error('Cannot create transaction with ' + table_name));
                }
                var store = transaction.objectStore(table_name);
                if (!store) {
                    status.reject(new Error('Cannot get object store with ' + table_name));
                }
                status.resolve(store);
            };
            return status.promise();
        },
        remove_indexed_db: function (dbName) {
            for (var i = 0; i <= 100; i++) {
                indexedDB.deleteDatabase(dbName + '_' + i);
            }
            this.do_notify(_t('Alert'),
                _t('Admin drop pos databases'));
        },
        show_application: function () {
            this.auto_drop_database = new exports.auto_drop_database(this);
            this.auto_drop_database.start();
            return this._super.apply(this, arguments).then(function () {
                return true
            });
        }
    });
});
