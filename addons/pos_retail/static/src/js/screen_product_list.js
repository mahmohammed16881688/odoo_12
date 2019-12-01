"use strict";
odoo.define('pos_retail.screen_product_list', function (require) {

    var models = require('point_of_sale.models');
    var screens = require('point_of_sale.screens');
    var core = require('web.core');
    var utils = require('web.utils');
    var round_pr = utils.round_precision;
    var qweb = core.qweb;
    var _t = core._t;
    var mobile_product_categories = require('pos_retail.mobile_product_categories');

    screens.ProductScreenWidget.include({
        click_product: function (product) {
            this._super.apply(this, arguments);
            this.pos._update_cart_qty_by_order([product.id]);
            var $p = $('span[data-product-id="' + product.id + '"]');
            $($p).animate({
                'opacity': 0.5,
            }, 300, function () {
                $($p).animate({
                    'opacity': 1,
                }, 300);
            });
        },
        refresh_screen: function () {
            this.pos.get_modifiers_backend('product.product');
            this.apply_quickly_search_products();
        },
        start: function () {
            var self = this;
            this._super();
            this.init_quickly_actions();
            for (var button in this.action_buttons) {
                var super_button = this.action_buttons[button];
                if (button == 'set_pricelist') {
                    super_button.button_click = function () {
                        if (!self.pos.config.allow_cashier_select_pricelist) {
                            return self.pos.gui.show_popup('dialog', {
                                title: 'Warning',
                                body: 'Your pos config have not allow you manual choose pricelist, contact your admin and check to checkbox: Go to POS config / Tab [Order and Booking] Allow cashiers select pricelist',
                            })
                        } else {
                            var pricelists = _.map(self.pos.pricelists, function (pricelist) {
                                return {
                                    label: pricelist.name,
                                    item: pricelist
                                };
                            });
                            self.pos.gui.show_popup('selection', {
                                title: _t('Select pricelist'),
                                list: pricelists,
                                confirm: function (pricelist) {
                                    var order = self.pos.get_order();
                                    order.set_pricelist(pricelist);
                                },
                                is_selected: function (pricelist) {
                                    return pricelist.id === self.pos.get_order().pricelist.id;
                                }
                            });
                        }
                    }
                }
            }
            var action_buttons = this.action_buttons;
            if (!this.pos.config.mobile_responsive) {
                for (var key in action_buttons) {
                    action_buttons[key].appendTo(this.$('.button-list'));
                }
            }
            var number_button = Object.keys(action_buttons).length;
            if (number_button == 0) { // auto hide button pane if have not any buttons need display
                $('.buttons_pane').css('display', 'none');
                $('.show_hide_buttons').css('display', 'none');
                if (!this.pos.config.mobile_responsive) {
                    $('.rightpane').css('left', '540px');
                }
                $('.pos-rightheader').css('left', '0px');
            }
            this.$('.control-buttons').addClass('oe_hidden');
            if (this.pos.config.product_view == 'box') {
                self.pos.set('set_product_view', {state: 'connected', pending: 0});
            } else {
                self.pos.set('set_product_view', {state: 'connecting', pending: 0});
            }
        },
        do_update_products_cache: function (product_datas) {
            var self = this;
            if (this.pos.server_version == 10) {
                this.pos.db.add_products(product_datas);
                for (var i = 0; i < product_datas.length; i++) {
                    var product = product_datas[i];
                    if (self.pos.db.stock_datas && self.pos.db.stock_datas[product['id']]) {
                        product['qty_available'] = self.pos.db.stock_datas[product['id']];
                    }
                    self.product_list_widget.product_cache.cache_node(product['id'], null);
                    var product_node = self.product_list_widget.render_product(product);
                    product_node.addEventListener('click', self.product_list_widget.click_product_handler);
                    var $product_el = $(".product-list " + "[data-product-id='" + product['id'] + "']");
                    if ($product_el.length > 0) {
                        $product_el.replaceWith(product_node);
                    }
                }
            }
            if ([11, 12].indexOf(this.pos.server_version) != -1) {
                this.pos.db.add_products(_.map(product_datas, function (product) {
                    var using_company_currency = self.pos.config.currency_id[0] === self.pos.company.currency_id[0];
                    if (self.pos.company_currency) {
                        var conversion_rate = self.pos.currency.rate / self.pos.company_currency.rate;
                    } else {
                        var conversion_rate = 1;
                    }
                    if (!using_company_currency) {
                        product['lst_price'] = round_pr(product.lst_price * conversion_rate, self.pos.currency.rounding);
                    }
                    if (self.pos.db.stock_datas && self.pos.db.stock_datas[product['id']]) {
                        product['qty_available'] = self.pos.db.stock_datas[product['id']];
                    }
                    product['categ'] = _.findWhere(self.pos.product_categories, {'id': product['categ_id'][0]});
                    product = new models.Product({}, product);
                    var current_pricelist = self.pos.default_pricelist;
                    var cache_key = self.product_list_widget.calculate_cache_key(product, current_pricelist);
                    self.product_list_widget.product_cache.cache_node(cache_key, null);
                    var product_node = self.product_list_widget.render_product(product);
                    product_node.addEventListener('click', self.product_list_widget.click_product_handler);
                    var contents = document.querySelector(".product-list " + "[data-product-id='" + product['id'] + "']");
                    if (contents) {
                        contents.replaceWith(product_node)
                    }
                    return product;
                }));
            }
            // if have any change, we update quickly search and re-render products screen
            this.apply_quickly_search_products();
        },
        // This function will eat more RAM memory
        // Pleas take care when call it
        rerender_products_screen: function (product_view) { // function work without mobile app
            if (this.pos.config.mobile_responsive) {
                return;
            }
            var self = this;
            this.pos.config.product_view = product_view;
            this.product_list_widget = new screens.ProductListWidget(this, {
                click_product_action: function (product) {
                    self.click_product(product);
                },
                product_list: self.pos.db.get_products(1000)
            });
            this.product_list_widget.replace($('.product-list-container')); // could not use: this.$('.product-list-container') because product operation update stock, could not refresh qty on hand
            this.product_categories_widget = new screens.ProductCategoriesWidget(this, {
                product_list_widget: self.product_list_widget,
            });
            this.$('.category-list-scroller').remove();
            this.$('.categories').remove();
            this.product_categories_widget.replace($('.rightpane-header'));  // could not use: this.$('.rightpane-header') because product operation update stock, could not refresh qty on hand
            $('input').click(function () {
                self.gui.screen_instances['products'].order_widget.remove_event_keyboard()
            });
        },
        init_quickly_actions: function () {
            var self = this;
            this.$('.add_customer').click(function () { // quickly add customer
                self.pos.gui.show_popup('popup_create_customer', {
                    title: 'Add customer'
                })
            });
            this.$('.add_product').click(function () { // quickly add product
                self.pos.gui.show_popup('popup_create_product', {
                    title: 'Add product',
                })
            });
            this.$('.add_pos_category').click(function () { // quickly add product
                self.pos.gui.show_popup('popup_create_pos_category', {
                    title: 'Add category'
                })
            });
            this.$('.quickly_payment').click(function () { // quickly payment
                if (!self.pos.config.quickly_payment_full_journal_id) {
                    return;
                }
                var order = self.pos.get_order();
                if (!order) {
                    return;
                }
                if (order.orderlines.length == 0) {
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Error',
                        body: 'Your order lines is blank'
                    })
                }
                var paymentlines = order.get_paymentlines();
                for (var i = 0; i < paymentlines.length; i++) {
                    paymentlines[i].destroy();
                }
                var register = _.find(self.pos.cashregisters, function (register) {
                    return register['journal']['id'] == self.pos.config.quickly_payment_full_journal_id[0];
                });
                if (!register) {
                    return self.pos.gui.show_popup('dialog', {
                        title: 'Error',
                        body: 'Your config not add quickly payment method, please add before use'
                    })
                }
                var amount_due = order.get_due();
                order.add_paymentline(register);
                var selected_paymentline = order.selected_paymentline;
                selected_paymentline.set_amount(amount_due);
                order.initialize_validation_date();
                self.pos.push_order(order);
                self.pos.gui.show_screen('receipt');

            });
        },
        apply_quickly_search_products: function () {
            var self = this;
            var $order_screen_find_product_box = this.$('.search-products');
            $order_screen_find_product_box.autocomplete({
                source: this.pos.db.get_products_source(),
                minLength: this.pos.config.min_length_search,
                select: function (event, ui) {
                    if (ui && ui['item'] && ui['item']['value']) {
                        var product = self.pos.db.get_product_by_id(ui['item']['value']);
                        if (product) {
                            self.pos.get_order().add_product(product);
                        }
                        setTimeout(function () {
                            self.product_categories_widget.clear_search();
                        }, 1000);
                    }

                }
            });
        },
        apply_quickly_search_partners: function () {
            var self = this;
            var $find_customer_box = this.$('.find_partner_input');
            if ($find_customer_box.length) {
                var sources = this.pos.db.get_partners_source();
                $find_customer_box.autocomplete({
                    source: sources,
                    minLength: this.pos.config.min_length_search,
                    select: function (event, ui) {
                        if (ui && ui['item'] && ui['item']['value']) {
                            var partner = self.pos.db.partner_by_id[parseInt(ui['item']['value'])];
                            if (partner) {
                                self.gui.screen_instances["clientlist"]['new_client'] = partner;
                                self.pos.trigger('client:save_changes');
                                setTimeout(function () {
                                    var input = $('.find_customer input');
                                    input.val("");
                                    input.focus();
                                }, 10);
                            }
                        }
                    }
                });
            } else {
                console.warn('$find_customer_box not found')
            }

        },
        show: function () {
            var self = this;
            this._super();
            this.apply_quickly_search_products();
            this.apply_quickly_search_partners();
            // when have update partners from backend
            // we re-add apply_quickly_search_partners
            this.pos.bind('refresh:partner_screen', function () {
                self.apply_quickly_search_partners();
            });
            this.pos.bind('reload:product-categories-screen', function () {
                if (this.pos.config.mobile_responsive) {
                    var $el_categories_list = $('.categories_list');
                    self.mobile_product_categories_widget = new mobile_product_categories(self, {
                        pos_categories: self.pos.pos_categories,
                    });
                    self.mobile_product_categories_widget.replace($el_categories_list);
                } else {
                    self.rerender_products_screen(self.pos.config.product_view);
                }

            }, self);
            if (!this.pos.config.mobile_responsive) {
                if (this.pos.show_left_buttons == true) {
                    $('.buttons_pane').animate({width: 220}, 'fast');
                    $('.leftpane').animate({left: 0}, 'fast');
                    $('.rightpane').animate({left: 760}, 'fast');
                    $('.show_hide_buttons .fa-caret-right').toggleClass('fa fa-th fa fa fa-caret-left');
                    this.pos.show_left_buttons = true;
                }
                if (this.pos.show_left_buttons == false) {
                    $('.buttons_pane').animate({width: 0}, 'fast');
                    $('.leftpane').animate({left: 0}, 'fast');
                    $('.rightpane').animate({left: 540}, 'fast');
                    $('.fa fa-list').toggleClass('highlight');
                    $('.show_hide_buttons .fa-list').toggleClass('fa fa-list fa fa-th');
                    this.pos.show_left_buttons = false;
                }
                $('.show_hide_buttons').addClass('highlight');
                $('.categories_list').css('width', '0%');
                $('.product-list-scroller').css('width', '100%');
            } else {
                // only for mobile app
                this.mobile_product_categories_widget = new mobile_product_categories(this, {
                    pos_categories: this.pos.pos_categories,
                });
                $('.category_home_icon').css('display', 'none');
                var $el_categories_list = $('.categories_list');
                this.mobile_product_categories_widget.replace($el_categories_list);
                $('.categories').css('display', 'none');
                $('.category-list').css('display', 'none');
                $('.categories_list').css('width', '20%');
                $('.product-list-scroller').css('width', '80%');
            }
            $('input').click(function () {
                self.gui.screen_instances['products'].order_widget.remove_event_keyboard();
            });
        }
    });

    screens.ProductListWidget.include({
        init: function (parent, options) {
            var self = this;
            this._super(parent, options);
            this.pos.bind('update:categories', function () {
                self.renderElement();
            }, this);
            // bind action only for v10
            // we are only change price of items display, not loop and change all, lost many memory RAM
            this.pos.bind('product:change_price_list', function (products) {
                try {
                    var $products_element = $('.product .product-img .price-tag');
                    for (var i = 0; i < $products_element.length; i++) {
                        var element = $products_element[i];
                        var product_id = parseInt(element.parentElement.parentElement.dataset.productId);
                        var product = self.pos.db.product_by_id(product_id);
                        if (product) {
                            var product = products[i];
                            var $product_el = $("[data-product-id='" + product['id'] + "'] .price-tag");
                            $product_el.html(self.format_currency(product['price']) + '/' + product['uom_id'][1]);
                        }
                    }
                } catch (e) {
                }
            });
            this.mouse_down = false;
            this.moved = false;
            this.auto_tooltip;
            this.product_mouse_down = function (e) {
                if (e.which == 1) {
                    $('.info_tooltip').remove();
                    self.right_arrangement = false;
                    self.moved = false;
                    self.mouse_down = true;
                    self.touch_start(this.dataset.productId, e.pageX, e.pageY);
                }
            };
            this.product_mouse_move = function (e) {
                $('.info_tooltip').remove();
                self.touch_start(this.dataset.productId, e.pageX, e.pageY);
            };
        },
        touch_start: function (product_id, x, y) {
            var self = this;
            this.auto_tooltip = setTimeout(function () {
                if (self.moved == false) {
                    this.right_arrangement = false;
                    var product = self.pos.db.get_product_by_id(parseInt(product_id));
                    var inner_html = self.generate_html(product);
                    $('.product-list-container').prepend(inner_html);
                    $(".close_button").on("click", function () {
                        $('#info_tooltip').remove();
                    });
                }
            }, 30);
        },
        generate_html: function (product) {
            var self = this;
            var last_price;
            var last_order_name;
            var lines_need_check = [];
            var write_date;
            var order = this.pos.get_order();
            if (order && order.get_client()) {
                var client = order.get_client();
                var orders = _.filter(this.pos.db.get_pos_orders(), function (order) {
                    return order.partner_id && order.partner_id[0] == client['id'];
                });
                if (orders) {
                    for (var i = 0; i < orders.length; i++) {
                        var order = orders[i];
                        var old_lines = order.lines;
                        if (!old_lines) {
                            continue
                        }
                        for (var j = 0; j < old_lines.length; j++) {
                            var line = old_lines[j];
                            if (line.product_id && line.product_id[0] == product['id']) {
                                lines_need_check.push(line)
                            }
                        }
                    }
                }
            }
            if (lines_need_check.length) {
                for (var j = 0; j < lines_need_check.length; j++) {
                    var line = lines_need_check[j];
                    if (!write_date) {
                        write_date = line.write_date;
                        last_price = line.price_unit;
                        last_order_name = line.order_id[1];
                        continue;
                    }
                    if (last_price != line.write_date && new Date(last_price).getTime() < new Date(line.write_date).getTime()) {
                        write_date = line.write_date;
                        last_price = line.price_unit;
                        last_order_name = line.order_id[1];
                    }
                }
            }
            var product_tooltip_html = qweb.render('product_tooltip', {
                widget: self,
                product: product,
                last_price: last_price,
                last_order_name: last_order_name
            });
            return product_tooltip_html;
        },
        touch_end: function () {
            if (this.auto_tooltip) {
                clearTimeout(this.auto_tooltip);
            }
        },
        /*
            We not return super odoo original method
            Because odoo pos original return old cache
            Some our functions need reload price, tax , name ...
         */
        render_product: function (product) {
            this._super(product);
            var current_pricelist = this.pos._get_active_pricelist();
            if (this.pos.server_version == 10) {
                var product_html = qweb.render('Product', {
                    widget: this,
                    product: product,
                    pricelist: current_pricelist,
                    image_url: this.get_product_image_url(product),
                });
                var product_node = document.createElement('tbody');
                product_node.innerHTML = product_html;
                product_node = product_node.childNodes[1];
                this.product_cache.cache_node(product.id, product_node);
                return product_node;
            } else {
                var cache_key = this.calculate_cache_key(product, current_pricelist);
                var product_html = qweb.render('Product', {
                    widget: this,
                    product: product,
                    pricelist: current_pricelist,
                    image_url: this.get_product_image_url(product),
                });
                var product_node = document.createElement('tbody');
                product_node.innerHTML = product_html;
                product_node = product_node.childNodes[1];
                this.product_cache.cache_node(cache_key, product_node);
                return product_node;
            }
        },
        sort_products_view: function () {
            var self = this;
            $('.sort_by_product_default_code').click(function () {
                self.product_list = self.product_list.sort(self.pos.sort_by('default_code', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase()
                }));
                self.renderElement();
                self.reverse = !self.reverse;
            });
            $('.sort_by_product_name').click(function () {
                self.product_list = self.product_list.sort(self.pos.sort_by('display_name', self.reverse, function (a) {
                    if (!a) {
                        a = 'N/A';
                    }
                    return a.toUpperCase()
                }));
                self.renderElement();
                self.reverse = !self.reverse;
            });
            $('.sort_by_product_list_price').click(function () {
                self.product_list = self.product_list.sort(self.pos.sort_by('list_price', self.reverse, parseInt));
                self.renderElement();
                self.reverse = !self.reverse;
            });
            $('.sort_by_product_standard_price').click(function () {
                self.product_list = self.product_list.sort(self.pos.sort_by('standard_price', self.reverse, parseInt));
                self.renderElement();
                self.reverse = !self.reverse;
            });
            $('.sort_by_product_qty_available').click(function () {
                self.product_list = self.product_list.sort(self.pos.sort_by('qty_available', self.reverse, parseInt));
                self.renderElement();
                self.reverse = !self.reverse;
            });
        },
        renderElement: function () {
            var self = this;
            if (this.pos.config.active_product_sort_by && this.pos.config.product_view == 'box') {
                if (this.pos.config.default_product_sort_by == 'a_z') {
                    this.product_list = this.product_list.sort(this.pos.sort_by('display_name', false, function (a) {
                        if (!a) {
                            a = 'N/A';
                        }
                        return a.toUpperCase()
                    }));
                } else if (this.pos.config.default_product_sort_by == 'z_a') {
                    this.product_list = this.product_list.sort(this.pos.sort_by('display_name', true, function (a) {
                        if (!a) {
                            a = 'N/A';
                        }
                        return a.toUpperCase()
                    }));
                } else if (this.pos.config.default_product_sort_by == 'low_price') {
                    this.product_list = this.product_list.sort(this.pos.sort_by('list_price', false, parseInt));
                } else if (this.pos.config.default_product_sort_by == 'high_price') {
                    this.product_list = this.product_list.sort(this.pos.sort_by('list_price', true, parseInt));
                } else if (this.pos.config.default_product_sort_by == 'pos_sequence') {
                    this.product_list = this.product_list.sort(this.pos.sort_by('pos_sequence', false, function (a) {
                        if (!a) {
                            a = 'N/A';
                        }
                        return a.toUpperCase()
                    }));
                }
            }
            if (this.pos.config.product_view == 'box') {
                this._super();
            } else {
                var el_str = qweb.render(this.template, {widget: this});
                var el_node = document.createElement('div');
                el_node.innerHTML = el_str;
                el_node = el_node.childNodes[1];

                if (this.el && this.el.parentNode) {
                    this.el.parentNode.replaceChild(el_node, this.el);
                }
                this.el = el_node;
                var list_container = el_node.querySelector('.product-list-contents');
                if (list_container) {
                    for (var i = 0, len = this.product_list.length; i < len; i++) {
                        var product_node = this.render_product(this.product_list[i]);
                        product_node.addEventListener('click', this.click_product_handler);
                        list_container.appendChild(product_node);
                    }
                }
            }
            if (this.pos.config.mobile_responsive) { // render categories for mobile app
                var $el_categories_list = $('.categories_list');
                self.mobile_product_categories_widget = new mobile_product_categories(self, {
                    pos_categories: self.pos.pos_categories,
                });
                self.mobile_product_categories_widget.replace($el_categories_list);
            }
            if (this.pos.config.tooltip) {
                var caches = this.product_cache;
                for (var cache_key in caches.cache) {
                    var product_node = this.product_cache.get_node(cache_key);
                    product_node.addEventListener('click', this.click_product_handler);
                    product_node.addEventListener('mousedown', this.product_mouse_down);
                    product_node.addEventListener('mousemove', this.product_mouse_move);
                }
                $(".product-list-scroller").scroll(function (event) {
                    $('#info_tooltip').remove();
                });
            }
            this.sort_products_view()
        },
        _get_default_pricelist: function () {
            var current_pricelist = this.pos.default_pricelist;
            return current_pricelist
        }
    });
});
