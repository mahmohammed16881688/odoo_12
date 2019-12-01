odoo.define('pos_retail.big_data', function (require) {
    var models = require('point_of_sale.models');
    var core = require('web.core');
    var _t = core._t;
    var rpc = require('pos.rpc');
    var indexed_db = require('pos_retail.indexedDB');
    var db = require('point_of_sale.DB');
    var utils = require('web.utils');
    var round_pr = utils.round_precision;
    var screens = require('point_of_sale.screens');

    var indexedDB = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB || window.shimIndexedDB;

    if (!indexedDB) {
        window.alert("Your browser doesn't support a stable version of IndexedDB.")
    }

    var button_remove_pos_cache = screens.ActionButtonWidget.extend({ // combo button
        template: 'button_remove_pos_cache',
        button_click: function () {
            this.pos.remove_indexed_db();
            this.pos.reload_pos()
        }
    });

    screens.define_action_button({
        'name': 'button_remove_pos_cache',
        'widget': button_remove_pos_cache,
        'condition': function () {
            return true;
        }
    });

    db.include({
        init: function (options) {
            this._super(options);
            this.write_date_by_model = {};
        },
        set_last_write_date_by_model: function (model, results) {
            /*
                We need to know last records updated (change by backend clients)
                And use field write_date compare datas of pos and datas of backend
                We are get best of write date and compare
             */
            for (var i = 0; i < results.length; i++) {
                var line = results[i];
                if (!this.write_date_by_model[model]) {
                    this.write_date_by_model[model] = line.write_date;
                    continue;
                }
                if (this.write_date_by_model[model] != line.write_date && new Date(this.write_date_by_model[model]).getTime() < new Date(line.write_date).getTime()) {
                    this.write_date_by_model[model] = line.write_date;
                }
            }
        },
        filter_datas_notifications_with_current_date: function(model, datas) {
            var self = this;
            var new_datas = _.filter(datas, function (data) {
                return new Date(self.write_date_by_model[data['model']]).getTime() < new Date(data['write_date']).getTime() + 1000;
            });
            return new_datas;
        },
        set_uuid: function (uuid) { // if current sessions have order unpaid, and products data have not exist , we need call product model get products the first
            this._super(uuid);
            var unpaid_orders = this.load('unpaid_orders', []);
            var product_ids = [];
            var product_model = _.find(self.posmodel.model_lock, function (model) {
                return model.fields != undefined && model.model == 'product.product';
            });
            if (unpaid_orders) {
                for (var i = 0; i < unpaid_orders.length; i++) {
                    var unpaid_order = unpaid_orders[i]['data'];
                    for (var j = 0; j < unpaid_order.lines.length; j++) {
                        var unpaid_line = unpaid_order.lines[j][2];
                        if (unpaid_line.product_id) {
                            product_ids.push(unpaid_line.product_id);
                        }
                    }
                }
            }
            if (product_ids.length && product_model.fields) {
                rpc.query({
                    model: 'product.product',
                    method: 'search_read',
                    domain: [['id', 'in', product_ids]],
                    fields: product_model.fields
                }).then(function (products) {
                    if (self.posmodel.server_version != 10) {
                        var using_company_currency = self.posmodel.config.currency_id[0] === self.posmodel.company.currency_id[0];
                        var conversion_rate;
                        if (self.posmodel.currency && self.posmodel.currency.rate && self.posmodel.company_currency && self.posmodel.company_currency.rate) {
                            conversion_rate = self.posmodel.currency.rate / self.posmodel.company_currency.rate;
                        } else {
                            conversion_rate = 1
                        }
                        self.posmodel.db.add_products(_.map(products, function (product) {
                            if (!using_company_currency) {
                                product.lst_price = round_pr(product.lst_price * conversion_rate, self.pos.currency.rounding);
                            }
                            product.categ = _.findWhere(self.posmodel.product_categories, {'id': product.categ_id[0]});
                            return new models.Product({}, product);
                        }));
                    }
                })
            }
        },
    });
    models.load_models([
        {
            model: 'product.pricelist.item',
            domain: function (self) {
                return [['pricelist_id', 'in', _.pluck(self.pricelists, 'id')]];
            },
            condition: function (self) {
                return self.server_version == 10;
            },
            loaded: function (self, pricelist_items) {
                var pricelist_by_id = {};
                _.each(self.pricelists, function (pricelist) {
                    pricelist_by_id[pricelist.id] = pricelist;
                });

                _.each(pricelist_items, function (item) {
                    var pricelist = pricelist_by_id[item.pricelist_id[0]];
                    pricelist.items.push(item);
                    item.base_pricelist = pricelist_by_id[item.base_pricelist_id[0]];
                });
            },
        }
    ], {
        before: 'product.product'
    });
    models.load_models([
        // FIRST WE ARE STORE FIELDS, DOMAIN, MODEL HAVE LARGE DATAS TO BACKEND FOR BACKEND HAVE FIELDS, DOMAIN AND SEARCH READ DATA RESPONSE POS
        {
            label: 'fields and domain products, customers, orders and invoices', // save parameters model used cache
            loaded: function (self) {
                var save_status = new $.Deferred();
                var models = {};
                for (var number in self.model_lock) {
                    var model = self.model_lock[number];
                    models[model['model']] = {
                        fields: model['fields'] || [],
                        domain: model['domain'] || [],
                        context: model['context'] || [],
                    };
                    if (model['model'] == 'res.partner') {
                        models[model['model']]['domain'] = []
                    }
                }
                return rpc.query({
                    model: 'pos.cache.database',
                    method: 'save_parameter_models_load',
                    args: [[], models]
                }).then(function (reinstall) {
                    save_status.resolve(reinstall);
                    if (reinstall) {
                        self.remove_indexed_db();
                        self.reload_pos();
                    }
                }).fail(function (error) {
                    self.reload_pos();
                    save_status.reject(error);
                });
                return save_status;
            },
        },
    ], {
        before: 'res.company'
    });
    models.load_models([
        {
            label: 'products',
            condition: function (self) {
                return self.config.big_datas;
            },
            loaded: function (self) {
                var status = new $.Deferred();
                $.when(indexed_db.get_products(self, self.session.model_ids['product.product']['max_id'] / 100000 + 1)).done(function () {
                    status.resolve()
                });
                return status;
            },
        },
        {
            label: 'syncing products',
            condition: function (self) {
                return self.config.big_datas;
            },
            sync: 'product.product',
            loaded: function (self) {
                var model = 'product.product';
                var status = self.session_start_get_modifiers_backend(model);
                return status
            },
        },
        {
            label: 'partners',
            condition: function (self) {
                return self.config.big_datas;
            },
            loaded: function (self) {
                var status = new $.Deferred();
                $.when(indexed_db.get_clients(self, self.session.model_ids['res.partner']['max_id'] / 100000 + 1)).done(function () {
                    status.resolve()
                });
                return status;
            },
        },
        {
            label: 'syncing partners',
            condition: function (self) {
                return self.config.big_datas;
            },
            sync: 'res.partner',
            loaded: function (self) {
                var model = 'res.partner';
                var status = self.session_start_get_modifiers_backend(model);
                return status
            },
        },
        {
            label: 'invoices',
            condition: function (self) {
                return self.config.big_datas;
            },
            loaded: function (self) {
                var status = new $.Deferred();
                $.when(indexed_db.get_invoices(self, self.session.model_ids['account.invoice']['max_id'] / 100000 + 1)).done(function () {
                    status.resolve()
                });
                return status;
            },
        },
        {
            label: 'syncing invoices',
            condition: function (self) {
                return self.config.big_datas;
            },
            sync: 'account.invoice',
            loaded: function (self) {
                var model = 'account.invoice';
                var status = self.session_start_get_modifiers_backend(model);
                return status
            },
        },
        {
            label: 'invoice lines',
            condition: function (self) {
                return self.config.big_datas;
            },
            loaded: function (self) {
                var status = new $.Deferred();
                $.when(indexed_db.get_invoice_lines(self, self.session.model_ids['account.invoice.line']['max_id'] / 100000 + 1)).done(function () {
                    status.resolve()
                });
                return status;
            },
        },
        {
            label: 'syncing invoice lines',
            condition: function (self) {
                return self.config.big_datas;
            },
            sync: 'account.invoice.line',
            loaded: function (self) {
                var model = 'account.invoice.line';
                var status = self.session_start_get_modifiers_backend(model);
                return status
            },
        },
        {
            label: 'pos orders',
            condition: function (self) {
                return self.config.big_datas;
            },
            loaded: function (self) {
                var status = new $.Deferred();
                $.when(indexed_db.get_pos_orders(self, self.session.model_ids['pos.order']['max_id'] / 100000 + 1)).done(function () {
                    status.resolve()
                });
                return status;
            },
        },
        {
            label: 'syncing pos orders',
            condition: function (self) {
                return self.config.big_datas;
            },
            sync: 'pos.order',
            loaded: function (self) {
                var model = 'pos.order';
                var status = self.session_start_get_modifiers_backend(model);
                return status
            },
        },
        {
            label: 'pos order lines',
            condition: function (self) {
                return self.config.big_datas;
            },
            loaded: function (self) {
                var status = new $.Deferred();
                $.when(indexed_db.get_pos_order_lines(self, self.session.model_ids['pos.order.line']['max_id'] / 100000 + 1)).done(function () {
                    status.resolve()
                });
                return status;
            },
        },
        {
            label: 'syncing pos order lines',
            condition: function (self) {
                return self.config.big_datas;
            },
            sync: 'pos.order.line',
            loaded: function (self) {
                var model = 'pos.order.line';
                var status = self.session_start_get_modifiers_backend(model);
                return status
            },
        },
        {
            label: 'sale orders',
            condition: function (self) {
                return self.config.big_datas;
            },
            loaded: function (self) {
                var status = new $.Deferred();
                $.when(indexed_db.get_sale_orders(self, self.session.model_ids['sale.order']['max_id'] / 100000 + 1)).done(function () {
                    status.resolve()
                });
                return status;
            },
        },
        {
            label: 'syncing sale orders',
            sync: 'sale.order',
            condition: function (self) {
                return self.config.big_datas;
            },
            loaded: function (self) {
                var model = 'sale.order';
                var status = self.session_start_get_modifiers_backend(model);
                return status
            },
        },
        {
            label: 'sale order lines',
            condition: function (self) {
                return self.config.big_datas;
            },
            loaded: function (self) {
                var status = new $.Deferred();
                $.when(indexed_db.get_sale_order_lines(self, self.session.model_ids['sale.order.line']['max_id'] / 100000 + 1)).done(function () {
                    status.resolve()
                });
                return status;
            },
        },
        {
            label: 'syncing sale lines',
            condition: function (self) {
                return self.config.big_datas;
            },
            sync: 'sale.order.line',
            loaded: function (self) {
                var model = 'sale.order.line';
                var status = self.session_start_get_modifiers_backend(model);
                return status
            },
        },
    ]);

    var _super_Order = models.Order.prototype;
    models.Order = models.Order.extend({
        set_client: function (client) {
            if (client && client['id'] && this.pos.deleted['res.partner'] && this.pos.deleted['res.partner'].indexOf(client['id']) != -1) {
                client = null;
                return this.pos.gui.show_popup('dialog', {
                    title: 'Blocked action',
                    body: 'This client deleted from backend'
                })
            }
            _super_Order.set_client.apply(this, arguments);
        },
    });
    var _super_PosModel = models.PosModel.prototype;
    models.PosModel = models.PosModel.extend({
        sort_by: function (field, reverse, primer) {
            var key = primer ?
                function (x) {
                    return primer(x[field])
                } :
                function (x) {
                    return x[field]
                };
            reverse = !reverse ? 1 : -1;
            return function (a, b) {
                return a = key(a), b = key(b), reverse * ((a > b) - (b > a));
            }
        },
        initialize: function (session, attributes) {
            this.deleted = {};
            this.init_sync_datas = {}; // variable save all datas change from backend when load pos, and when screen init done. We resync
            this.total_products = 0;
            this.total_clients = 0;
            this.load_indexed_db_done = false;
            this.max_load = 9999;
            this.next_load = 10000;
            this.session = session;
            this.sequence = 0;
            this.model_lock = [];
            this.model_unlock = [];
            this.model_ids = session['model_ids'];
            for (var i = 0; i < this.models.length; i++) {
                var this_model = this.models[i];
                if (this_model.model && this.model_ids[this_model.model]) {
                    this_model['max_id'] = this.model_ids[this_model.model]['max_id'];
                    this_model['min_id'] = this.model_ids[this_model.model]['min_id'];
                    this.model_lock = _.filter(this.model_lock, function (model_check) {
                        return model_check['model'] != this_model.model;
                    });
                    this.model_lock.push(this_model);

                } else {
                    this.model_unlock.push(this_model);
                }
            }
            if (this.server_version == 10) {
                var currency_model = _.find(this.models, function (model) {
                    return model.model && model.model == "res.currency"
                });
                currency_model.ids = function (self) {
                    return [session.currency_id]
                };
                var pricelist_loaded = this.get_model('product.pricelist');
                pricelist_loaded.ids = undefined;
                pricelist_loaded.fields = [];
                pricelist_loaded.domain = [];
                var pricelist_loaded_super = pricelist_loaded.loaded;
                pricelist_loaded.loaded = function (self, pricelists) {
                    pricelist_loaded_super(self, pricelists);
                    if (!pricelists) {
                        console.error('Pricelist is null')
                    }
                    self.pricelist_by_id = {};
                    self.default_pricelist = _.find(pricelists, {id: self.config.pricelist_id[0]});
                    self.pricelists = pricelists;
                    _.map(pricelists, function (pricelist) {
                        pricelist.items = [];
                        self.pricelist_by_id[pricelist['id']] = pricelist;
                    });
                };
            }
            _super_PosModel.initialize.call(this, session, attributes)
        },
        get_process_time: function (min, max) {
            if (min > max) {
                return 1
            } else {
                return (min / max).toFixed(1)
            }
        },
        session_start_get_modifiers_backend: function (model) {
            var self = this;
            var status = new $.Deferred();
            if (this.db.write_date_by_model[model]) { // this.write_date save on file big_data.js
                return rpc.query({
                    model: 'pos.cache.database',
                    method: 'get_modifiers_backend',
                    args: [[], this.db.write_date_by_model[model], model]
                }).then(function (results) {
                    if (results.length) {
                        var model = results[0]['model'];
                        console.log('===> backend have new changed from model: ' + model + ' total: ' + results.length);
                        self.init_sync_datas[model] = results;
                    }
                    status.resolve();
                }).fail(function (error) {
                    if (error.code == -32098) {
                        console.warn('Your odoo backend offline, or your internet connection have problem');
                    } else {
                        console.warn('Your database have issues, could sync with pos');
                    }
                    status.reject();
                });
                return status
            } else {
                status.resolve();
                return status
            }
        },
        get_modifiers_backend: function (model) {
            var self = this;
            var status = new $.Deferred();
            if (this.db.write_date_by_model[model]) { // this.write_date save on file big_data.js
                return rpc.query({
                    model: 'pos.cache.database',
                    method: 'get_modifiers_backend',
                    args: [[], this.db.write_date_by_model[model], model]
                }).then(function (results) {
                    if (results.length) {
                        var model = results[0]['model'];
                        self.sync_with_backend(model, results);
                    }
                    status.resolve();
                }).fail(function (error) {
                    if (error.code == -32098) {
                        console.warn('Your odoo backend offline, or your internet connection have problem');
                    } else {
                        console.warn('Your database have issues, could sync with pos');
                    }
                    status.reject();
                });
                return status
            } else {
                status.resolve();
                return status
            }
        },
        save_results: function (model, results) { // this method only call when indexdb_db running
            var object = _.find(this.model_lock, function (object_loaded) {
                return object_loaded.model == model;
            });
            if (object) {
                object.loaded(this, results, {})
            }
            if (model == 'product.product') {
                this.total_products += results.length;
                var process_time = this.get_process_time(this.total_products, this.model_ids[model]['max_id']);
                console.log('save_results products ' + this.total_products);
                this.chrome.loading_message(_t('Products loaded: ' + (process_time * 100).toFixed(0) + ' %'), process_time);
            }
            if (model == 'res.partner') {
                this.total_clients += results.length;
                var process_time = this.get_process_time(this.total_clients, this.model_ids[model]['max_id']);
                console.log('save_results clients ' + this.total_clients);
                this.chrome.loading_message(_t('Partners loaded: ' + (process_time * 100).toFixed(0) + ' %'), process_time);
            }
            this.load_indexed_db_done = true;
            this.db.set_last_write_date_by_model(model, results);
        },
        reload_pos: function () {
            location.reload();
        },
        api_install_datas: function (model_name) {
            var self = this;
            var loaded = new $.Deferred();
            var model = _.find(this.model_lock, function (model) {
                return model.model == model_name;
            });
            if (!model) {
                return loaded.resolve();
            }

            function installing_data(model_name, min_id, max_id) {
                var domain = [['id', '>=', min_id], ['id', '<', max_id]];
                var context = {};
                // context['retail'] = true;
                if (model['model'] == 'product.product') {
                    domain.push(['available_in_pos', '=', true]);
                    var price_id = null;
                    if (self.pricelist) {
                        price_id = self.pricelist.id;
                    }
                    var stock_location_id = null;
                    if (self.config.stock_location_id) {
                        stock_location_id = self.config.stock_location_id[0]
                    }
                    context['location'] = stock_location_id;
                    context['pricelist'] = price_id;
                    context['display_default_code'] = false;
                }
                if (min_id == 0) {
                    max_id = self.max_load;
                }
                return rpc.query({
                    model: 'pos.cache.database',
                    method: 'install_data',
                    args: [null, model_name, min_id, max_id]
                }).then(function (results) {
                    min_id += self.next_load;
                    if (typeof results == "string") {
                        results = JSON.parse(results);
                    }
                    if (results.length > 0) {
                        var process = self.get_process_time(min_id, model['max_id']);
                        self.chrome.loading_message(_t('Keep POS online, caching datas of ') + model['model'] + ': ' + (process * 100).toFixed(3) + ' %', process);
                        max_id += self.next_load;
                        installing_data(model_name, min_id, max_id);
                        indexed_db.write(model_name, results);
                        self.save_results(model_name, results);
                    } else {
                        if (max_id < model['max_id']) {
                            max_id += self.next_load;
                            installing_data(model_name, min_id, max_id);
                        } else {
                            loaded.resolve();
                        }
                    }
                }).fail(function (error) {
                    var db = self.session.db;
                    for (var i = 0; i <= 100; i++) {
                        indexedDB.deleteDatabase(db + '_' + i);
                    }
                    self.reload_pos();
                    if (error.code == -32098) {
                        self.chrome.loading_message(_t('Your odoo backend offline, or your internet connection have problem'));
                    } else {
                        self.chrome.loading_message(_t('Installing error, remove cache and try again'));
                    }
                });
            }

            installing_data(model_name, 0, self.first_load);
            return loaded;
        },
        remove_indexed_db: function () {
            var dbName = this.session.db;
            for (var i = 0; i <= 50; i++) {
                indexedDB.deleteDatabase(dbName + '_' + i);
            }
            console.warn('have another user deleted pos database via polling')
        },
        load_server_data: function () {
            var self = this;
            if (this.session.big_datas) {
                this.models = this.model_unlock;
            } else {
                this.remove_indexed_db();
            }
            return _super_PosModel.load_server_data.apply(this, arguments).then(function () {
                if (!self.config.big_datas) {
                    return true;
                }
                for (var index_number in self.model_lock) {
                    self.models.push(self.model_lock[index_number]);
                }
                if (!self.load_indexed_db_done) {
                    return $.when(self.api_install_datas('product.product')).then(function () {
                        return $.when(self.api_install_datas('res.partner')).then(function () {
                            return $.when(self.api_install_datas('account.invoice')).then(function () {
                                return $.when(self.api_install_datas('account.invoice.line')).then(function () {
                                    return $.when(self.api_install_datas('pos.order')).then(function () {
                                        return $.when(self.api_install_datas('pos.order.line')).then(function () {
                                            return $.when(self.api_install_datas('sale.order')).then(function () {
                                                return $.when(self.api_install_datas('sale.order.line')).then(function () {
                                                    var models_sync = _.filter(self.models, function (model) {
                                                        return model['sync'] != undefined;
                                                    });
                                                    for (var index in models_sync) {
                                                        var model = models_sync[index];
                                                        self.get_modifiers_backend(model['sync']);
                                                    }
                                                })
                                            })
                                        })
                                    })
                                })
                            })
                        })
                    })
                } else {
                    return true;
                }
            }).then(function () {
                if (!self.config.big_datas) {
                    return true;
                }
                return true;
            })
        }
    });
})
;
