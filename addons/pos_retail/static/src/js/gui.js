odoo.define('pos_retail.gui', function (require) {
    "use strict";
    var gui = require('point_of_sale.gui');

    gui.Gui.include({
        show_popup: function (name, options) {
            if (!this.pos.config.is_customer_screen) {
                return this._super(name, options);
            } else {
                return null;
            }
        }
    });
});
