odoo.define('pos_retail.chromes', function (require) {
    "use strict";

    var chrome = require('point_of_sale.chrome');
    var core = require('web.core');
    var _t = core._t;
    var session = require('web.session');

    var button_list_widget = chrome.StatusWidget.extend({
        template: 'button_list_widget',
        init: function () {
            this._super(arguments[0], {});
            this.show = true;
        },
        start: function () {
            var self = this;
            this._super();
            $('.show_hide_buttons').click(function () {
                var current_screen = self.pos.gui.get_current_screen();
                if (current_screen == 'products') {
                    if (self.pos.show_left_buttons == true || self.pos.show_left_buttons == undefined) {
                        $('.buttons_pane').animate({width: 0}, 'fast');
                        $('.leftpane').animate({left: 0}, 'fast');
                        $('.rightpane').animate({left: 540}, 'fast');
                        $('.fa fa-list').toggleClass('highlight');
                        $('.show_hide_buttons .fa-list').toggleClass('fa-list fa-th');
                        $('.quickly_buttons').animate({width: 0}, 'slow');
                        $('.quickly_buttons').toggleClass('oe_hidden');
                        self.pos.show_left_buttons = false;
                    } else {
                        $('.quickly_buttons').animate({width: '100%'}, 'slow');
                        $('.quickly_buttons').removeClass('oe_hidden');
                        $('.buttons_pane').animate({width: 220}, 'fast');
                        $('.leftpane').animate({left: 0}, 'fast');
                        $('.rightpane').animate({left: 760}, 'fast');
                        $('.show_hide_buttons .fa-th').toggleClass('fa-th fa-list');
                        self.pos.show_left_buttons = true;
                    }
                }
            });
        }
    });
    chrome.Chrome.include({
        build_widgets: function () {
            if (!this.pos.config.mobile_responsive) {
                this.widgets = _.filter(this.widgets, function (widget) {
                    return widget['name'] != 'button_list_widget';
                });
                this.widgets.push(
                    {
                        'name': 'button_list_widget',
                        'widget': button_list_widget,
                        'append': '.pos-branding',
                    }
                );
            }
            this._super();
        }
    });

    // validate delete order
    chrome.OrderSelectorWidget.include({
        deleteorder_click_handler: function (event, $el) {
            var orders = this.pos.get('orders');
            if (orders.length == 1) {
                return this.pos.gui.show_popup('dialog', {
                    'title': _t('Error'),
                    'body': _t('Could not delete order, pos required minimum have 1 order still on pos'),
                });
            }
            if (this.pos.config.validate_remove_order) {
                return this.pos.gui.show_popup('ask_password', {
                    title: 'Blocked',
                    body: 'Please input pos pass pin for unlock',
                    confirm: function (value) {
                        var pin;
                        if (this.pos.config.validate_by_user_id) {
                            var user_validate = this.pos.user_by_id[this.pos.config.validate_by_user_id[0]];
                            pin = user_validate['pos_security_pin']
                        } else {
                            pin = this.pos.user.pos_security_pin
                        }
                        if (value != pin) {
                            return this.pos.gui.show_popup('dialog', {
                                title: 'Wrong',
                                body: 'Password not correct, please check pos security pin',
                            })
                        } else {
                            var self = this;
                            var order = this.pos.get_order();
                            if (!order) {
                                return;
                            } else if (!order.is_empty()) {
                                this.pos.gui.show_popup('confirm', {
                                    'title': _t('Destroy Current Order ?'),
                                    'body': _t('You will lose any data associated with the current order'),
                                    confirm: function () {
                                        self.pos.delete_current_order();
                                    },
                                });
                            } else {
                                this.pos.delete_current_order();
                            }
                        }
                    }
                })
            } else {
                return this._super()
            }
        },
        renderElement: function () {
            this._super();
            if (!this.pos.config.allow_remove_order || this.pos.config.allow_remove_order == false || this.pos.config.staff_level == 'marketing' || this.pos.config.staff_level == 'waiter' || this.pos.config.is_customer_screen) {
                this.$('.deleteorder-button').replaceWith('');
            }
            if (!this.pos.config.allow_add_order || this.pos.config.allow_add_order == false || this.pos.config.is_customer_screen) {
                this.$('.neworder-button').replaceWith('');
            }
            if (this.pos.config.is_customer_screen) {
                $('.pos .order-selector').css('display', 'none');
            }
        }
    });

    chrome.HeaderButtonWidget.include({
        renderElement: function () {
            var self = this;
            this._super();
            if (this.action) {
                this.$el.click(function () {
                    if (self.pos.config.close_session) {
                        session.rpc("/web/session/destroy", {});
                        window.open("/web/login", "_self");
                    }
                    if (self.pos.config.validate_close_session) {
                        return self.pos.gui.show_popup('ask_password', {
                            title: 'Blocked',
                            body: 'Please input pos pass pin for close session',
                            confirm: function (value) {
                                var pin;
                                if (this.pos.config.validate_by_user_id) {
                                    var user_validate = this.pos.user_by_id[this.pos.config.validate_by_user_id[0]];
                                    pin = user_validate['pos_security_pin']
                                } else {
                                    pin = this.pos.user.pos_security_pin
                                }
                                if (value != pin) {
                                    return this.pos.gui.show_popup('dialog', {
                                        title: 'Wrong',
                                        body: 'Password not correct, please check pos security pin'
                                    })
                                } else {
                                    return this.pos.gui.close();
                                }
                            }
                        })
                    } else {
                        self.action();
                    }
                });
            }
        }
    })
});
