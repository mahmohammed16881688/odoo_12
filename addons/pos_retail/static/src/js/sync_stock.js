odoo.define('pos_retail.sync_stock', function (require) {
    var models = require('point_of_sale.models');
    var exports = {};
    var Backbone = window.Backbone;
    var bus = require('pos_retail.core_bus');
    var rpc = require('pos.rpc');

    exports.sync_stock = Backbone.Model.extend({ // chanel 2: pos sync backend
        initialize: function (pos) {
            this.pos = pos;
        },
        start: function () {
            this.bus = bus.bus;
            this.bus.last = this.pos.db.load('bus_last', 0);
            this.bus.on("notification", this, this.on_notification);
            this.bus.start_polling();
        },
        on_notification: function (notifications) {
            if (notifications && notifications[0] && notifications[0][1]) {
                for (var i = 0; i < notifications.length; i++) {
                    var channel = notifications[i][0][1];
                    if (channel == 'pos.sync.stock') {
                        var product_ids = JSON.parse(notifications[i][1]);
                        this.pos._do_update_quantity_onhand(product_ids);
                    }
                }
            }
        }
    });

    var _super_posmodel = models.PosModel.prototype;
    models.PosModel = models.PosModel.extend({
        _do_update_quantity_onhand: function (product_ids) {
            var def = new $.Deferred();
            var location = this.get_location() || null;
            if (!location) {
                return
            }
            var location_id = location['id'];
            var self = this;
            rpc.query({
                model: 'stock.move',
                method: 'get_stock_datas',
                args: [location_id, product_ids],
                context: {}
            }).then(function (datas) {
                var products = [];
                for (var product_id in datas) {
                    var product = self.db.product_by_id[product_id];
                    if (product) {
                        products.push(product);
                        var qty_available = datas[product_id];
                        self.db.stock_datas[product['id']] = qty_available;
                        console.log(product['display_name'] + ' qty_available : ' + qty_available)
                    }
                }
                if (products.length) {
                    self.gui.screen_instances["products"].do_update_products_cache(products);
                    self.gui.screen_instances["products_operation"].refresh_screen();
                }
                return def.resolve()
            }).fail(function (type, error) {
                return def.resolve(error);
            });
            return def;
        },
        load_server_data: function () {
            var self = this;
            return _super_posmodel.load_server_data.apply(this, arguments).then(function () {
                if (self.config.display_onhand) {
                    self.sync_stock = new exports.sync_stock(self);
                    self.sync_stock.start();
                }
            })
        },
    });

    return exports;
});
