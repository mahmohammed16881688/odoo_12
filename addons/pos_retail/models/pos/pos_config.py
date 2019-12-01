# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
import logging
from odoo.exceptions import UserError

try:
    to_unicode = unicode
except NameError:
    to_unicode = str

_logger = logging.getLogger(__name__)


class pos_config_image(models.Model):
    _name = "pos.config.image"
    _description = "Image show to customer screen"

    name = fields.Char('Title', required=1)
    image = fields.Binary('Image', required=1)
    config_id = fields.Many2one('pos.config', 'POS config', required=1)
    description = fields.Text('Description')


class pos_config(models.Model):
    _inherit = "pos.config"

    @api.multi
    def set_pricelists_to_pos_sessions_online_without_reload(self):
        for config in self:
            if config.pricelist_id:
                config.pricelist_id.sync_pricelists_all_pos_online()
                break
            else:
                raise UserError('Please active pricelist and set pricelist default')
        return True

    user_id = fields.Many2one('res.users', 'Assigned to')
    config_access_right = fields.Boolean('Config access right', default=1)
    allow_discount = fields.Boolean('Change discount', default=1)
    allow_qty = fields.Boolean('Change quantity', default=1)
    allow_price = fields.Boolean('Change price', default=1)
    allow_remove_line = fields.Boolean('Remove line', default=1)
    allow_numpad = fields.Boolean('Display numpad', default=1)
    allow_payment = fields.Boolean('Display payment', default=1)
    allow_customer = fields.Boolean('Choose customer', default=1)
    allow_add_order = fields.Boolean('New order', default=1)
    allow_remove_order = fields.Boolean('Remove order', default=1)
    allow_add_product = fields.Boolean('Add line', default=1)

    allow_lock_screen = fields.Boolean('Lock screen when session start',
                                       default=0,
                                       help='When pos sessions start, \n'
                                            'cashiers required open POS via pos pass pin (Setting/Users)')
    lock_state = fields.Selection([
        ('unlock', 'Un lock'),
        ('locked', 'Locked')
    ], default='unlock', string='Lock state')

    display_point_receipt = fields.Boolean('Display point / receipt')
    loyalty_id = fields.Many2one('pos.loyalty', 'Loyalty',
                                 domain=[('state', '=', 'running')])

    promotion_manual_select = fields.Boolean('Promotion manual choose', default=0,
                                             help='When you check to this checkbox, \n'
                                                  'your cashiers will have one button, \n'
                                                  'when cashiers clicked on it, \n'
                                                  'all promotions active will display for choose')
    promotion_auto_add = fields.Boolean('Promotion auto', help='When you check it,\n'
                                                               ' when your cashiers click payment button,\n'
                                                               ' all promotions active auto add to order cart')

    create_purchase_order = fields.Boolean('Create PO', default=0)
    create_purchase_order_required_signature = fields.Boolean('PO Required signature', default=0)
    purchase_order_state = fields.Selection([
        ('confirm_order', 'Auto confirm'),
        ('confirm_picking', 'Auto delivery'),
        ('confirm_invoice', 'Auto invoice'),
    ], 'PO state',
        help='This is state of purchase order will process to',
        default='confirm_invoice')
    sale_order = fields.Boolean('Create Sale order', default=0)
    sale_order_auto_confirm = fields.Boolean('Auto confirm', default=0)
    sale_order_auto_invoice = fields.Boolean('Auto paid', default=0)
    sale_order_auto_delivery = fields.Boolean('Auto delivery', default=0)
    sale_order_print_receipt = fields.Boolean('Print receipt', help='Allow print receipt when create quotation/order')
    sale_order_required_signature = fields.Boolean('SO Required signature',
                                                   help='Allow print receipt when create quotation/order')

    pos_orders_management = fields.Boolean('POS order management', default=0)
    pos_order_period_return_days = fields.Float('Return period days',
                                                help='this is period time for customer can return order',
                                                default=30)
    display_return_days_receipt = fields.Boolean('Display return days receipt', default=0)
    display_onhand = fields.Boolean('Show qty available product', default=1,
                                    help='Display quantity on hand all products on pos screen')
    allow_order_out_of_stock = fields.Boolean('Allow out-of-stock', default=1,
                                              help='If checked, allow cashier can add product have out of stock')
    print_voucher = fields.Boolean('Create/Print voucher', help='Allow cashiers create voucher on POS', default=0)
    expired_days_voucher = fields.Integer('Expired days of voucher', default=30,
                                          help='Total days keep voucher can use, \n'
                                               'if out of period days from create date, voucher will expired')
    sync_multi_session = fields.Boolean('Sync multi session', default=0)
    sync_session_turn_on_dialog = fields.Boolean('Turn on dialog',
                                                 help='If checked, pos auto turn on dialog when sync sessions')
    bus_id = fields.Many2one('pos.bus', string='Branch/store')
    display_person_add_line = fields.Boolean('Display information line', default=0,
                                             help="When you checked, on pos order lines screen, \n"
                                                  "will display information person created order \n"
                                                  "(lines) Eg: create date, updated date ..")
    quickly_payment = fields.Boolean('Quickly payment', default=0)
    internal_transfer = fields.Boolean('Internal transfer', default=0,
                                       help='Go Inventory and active multi warehouse and location')
    internal_transfer_auto_validate = fields.Boolean('Internal transfer auto validate', default=0)

    discount = fields.Boolean('Global discount', default=0)
    discount_ids = fields.Many2many('pos.global.discount',
                                    'pos_config_pos_global_discount_rel',
                                    'config_id',
                                    'discount_id',
                                    'Global discounts')
    is_customer_screen = fields.Boolean('Is customer screen')
    delay = fields.Integer('Delay time', default=3000)
    slogan = fields.Char('Slogan', help='This is message will display on screen of customer')
    image_ids = fields.One2many('pos.config.image', 'config_id', 'Images')

    tooltip = fields.Boolean('Show information of product', default=0)
    tooltip_show_last_price = fields.Boolean('Show last price of product',
                                             help='Show last price of items of customer have bought before',
                                             default=0)
    tooltip_show_minimum_sale_price = fields.Boolean('Show min of product sale price',
                                                     help='Show minimum sale price of product',
                                                     default=0)
    discount_limit = fields.Boolean('Discount limit', default=0)
    discount_limit_amount = fields.Float('Discount limit amount', default=10)
    discount_each_line = fields.Boolean('Discount each line')
    discount_unlock_limit = fields.Boolean('Manager can unlock limit')
    discount_unlock_limit_user_id = fields.Many2one('res.users', 'User unlock limit amount')

    multi_currency = fields.Boolean('Multi currency', default=0)
    multi_currency_update_rate = fields.Boolean('Update rate', default=0)

    return_products = fields.Boolean('Return products',
                                     help='Allow cashier return products, orders',
                                     default=0)
    receipt_without_payment_template = fields.Selection([
        ('none', 'None'),
        ('display_price', 'Display price'),
        ('not_display_price', 'Not display price')
    ], default='not_display_price', string='Review receipt order')
    lock_order_printed_receipt = fields.Boolean('Lock order printed receipt', default=0)
    staff_level = fields.Selection([
        ('manual', 'Manual config'),
        ('marketing', 'Marketing'),
        ('waiter', 'Waiter'),
        ('cashier', 'Cashier'),
        ('manager', 'Manager')
    ], string='Staff level', default='manual')

    validate_payment = fields.Boolean('Validate payment')
    validate_remove_order = fields.Boolean('Validate remove order')
    validate_change_minus = fields.Boolean('Validate pressed +/-')
    validate_quantity_change = fields.Boolean('Validate quantity change')
    validate_price_change = fields.Boolean('Validate price change')
    validate_discount_change = fields.Boolean('Validate discount change')
    validate_close_session = fields.Boolean('Validate close session')
    validate_by_user_id = fields.Many2one('res.users', 'Validate by admin')
    apply_validate_return_mode = fields.Boolean('Validate return mode',
                                                help='If checked, only applied validate when return order', default=1)

    print_user_card = fields.Boolean('Print user card')

    product_operation = fields.Boolean('Product Operation', default=0,
                                       help='Allow cashiers add pos categories and products on pos screen')
    quickly_payment_full = fields.Boolean('Quickly payment full')
    quickly_payment_full_journal_id = fields.Many2one('account.journal', 'Payment mode',
                                                      domain=[('journal_user', '=', True),
                                                              ('pos_method_type', '=', 'default')])
    note_order = fields.Boolean('Note order', default=0)
    note_orderline = fields.Boolean('Note order line', default=0)
    signature_order = fields.Boolean('Signature order', default=0)
    quickly_buttons = fields.Boolean('Quickly Actions', default=0)
    display_amount_discount = fields.Boolean('Display amount discount', default=0)

    booking_orders = fields.Boolean('Booking orders', default=0)
    booking_orders_required_cashier_signature = fields.Boolean('Book order required sessions signature',
                                                               help='Checked if need required pos seller signature',
                                                               default=0)
    booking_orders_alert = fields.Boolean('Alert when new order coming', default=0)
    delivery_orders = fields.Boolean('Delivery orders',
                                     help='Pos clients can get booking orders and delivery orders',
                                     default=0)
    booking_orders_display_shipping_receipt = fields.Boolean('Display shipping on receipt', default=0)

    display_tax_orderline = fields.Boolean('Display tax orderline', default=0)
    display_tax_receipt = fields.Boolean('Display tax receipt', default=0)
    display_fiscal_position_receipt = fields.Boolean('Display fiscal position on receipt', default=0)

    display_image_orderline = fields.Boolean('Display image order line', default=0)
    display_image_receipt = fields.Boolean('Display image receipt', default=0)
    duplicate_receipt = fields.Boolean('Duplicate Receipt')
    print_number = fields.Integer('Print number', help='How many number receipt need to print at printer ?', default=0)
    category_wise_receipt = fields.Boolean('Category wise receipt', default=0)

    management_invoice = fields.Boolean('Display Invoices screen', default=0)
    invoice_offline = fields.Boolean('Payment with invoice offline',
                                     help='Help cashiers passing waiting time print invoice')
    wallet = fields.Boolean('Add change amount to wallet card',
                            help='Add change amount of customer to customer wallet card')
    invoice_journal_ids = fields.Many2many(
        'account.journal',
        'pos_config_invoice_journal_rel',
        'config_id',
        'journal_id',
        'Accounting Invoice Journal',
        domain=[('type', '=', 'sale')],
        help="Accounting journal use for create invoices.")
    send_invoice_email = fields.Boolean('Send email invoice', help='Help cashier send invoice to email of customer',
                                        default=0)
    lock_print_invoice_on_pos = fields.Boolean('Lock print invoice',
                                               help='Lock print pdf invoice when clicked button invoice', default=0)
    pos_auto_invoice = fields.Boolean('Auto create invoice',
                                      help='Automatic create invoice if order have client',
                                      default=0)
    receipt_invoice_number = fields.Boolean('Add invoice on receipt', help='Show invoice number on receipt header',
                                            default=0)
    receipt_customer_vat = fields.Boolean('Add vat customer on receipt',
                                          help='Show customer VAT(TIN) on receipt header', default=0)
    auto_register_payment = fields.Boolean('Auto invocie register payment', default=0)

    fiscal_position_auto_detect = fields.Boolean('Fiscal position auto detect', default=0)

    display_sale_price_within_tax = fields.Boolean('Display sale price within tax', default=0)
    display_cost_price = fields.Boolean('Display product cost price', default=0)
    display_product_ref = fields.Boolean('Display product ref', default=0)
    hide_product_image = fields.Boolean('Hide product image', default=0)
    multi_location = fields.Boolean('Multi location', default=0)
    product_view = fields.Selection([
        ('box', 'Box view'),
        ('list', 'List view'),
    ], default='box', string='View of products screen', required=1)

    ticket_font_size = fields.Integer('Ticket font size', default=12)
    customer_default_id = fields.Many2one('res.partner', 'Customer default')
    medical_insurance = fields.Boolean('Medical insurance', default=0)
    set_guest = fields.Boolean('Set guest', default=0)
    reset_sequence = fields.Boolean('Reset sequence order', default=0)
    update_tax = fields.Boolean('Modify tax', default=0, help='Cashier can change tax of order line')
    update_tax_ids = fields.Many2many('account.tax', 'pos_config_tax_rel', 'config_id', 'tax_id', string='List Taxes')
    subtotal_tax_included = fields.Boolean('Show Tax-Included Prices',
                                           help='When checked, subtotal of line will display amount have tax-included')
    cash_out = fields.Boolean('Take money out', default=0, help='Allow cashiers take money out')
    cash_in = fields.Boolean('Push money in', default=0, help='Allow cashiers input money in')
    min_length_search = fields.Integer('Min character length search', default=3,
                                       help='Allow auto suggestion items when cashiers input on search box')
    review_receipt_before_paid = fields.Boolean('Review receipt before paid', help='Show receipt before paid order',
                                                default=1)
    keyboard_event = fields.Boolean('Keyboard event', default=1, help='Allow cashiers use shortcut keyboard')
    switch_user = fields.Boolean('Switch user', default=0, help='Allow cashiers switch to another cashier')
    change_unit_of_measure = fields.Boolean('Change unit of measure', default=0,
                                            help='Allow cashiers change unit of measure of order lines')
    print_last_order = fields.Boolean('Print last receipt', default=0, help='Allow cashiers print last receipt')
    close_session = fields.Boolean('Logout when close session',
                                   help='When cashiers click close pos, auto log out of system',
                                   default=0)
    display_image_product = fields.Boolean('Display image product', default=1,
                                           help='Allow hide/display product images on pos screen')
    printer_on_off = fields.Boolean('On/Off printer', help='Help cashier turn on/off printer via posbox', default=0)
    check_duplicate_email = fields.Boolean('Check duplicate email', default=0)
    check_duplicate_phone = fields.Boolean('Check duplicate phone', default=0)
    hide_country = fields.Boolean('Hide country', default=0)
    hide_barcode = fields.Boolean('Hide barcode', default=0)
    hide_tax = fields.Boolean('Hide tax', default=0)
    hide_pricelist = fields.Boolean('Hide pricelists', default=0)
    hide_supplier = fields.Boolean('Hide suppiers', default=1)
    auto_remove_line = fields.Boolean('Auto remove line',
                                      default=1,
                                      help='When cashier set quantity of line to 0, \n'
                                           'line auto remove not keep line with qty is 0')
    chat = fields.Boolean('Chat message', default=0, help='Allow chat, discuss between pos sessions')
    add_tags = fields.Boolean('Add tags line', default=0, help='Allow cashiers add tags to order lines')
    add_sale_person = fields.Boolean('Add sale person', default=0)
    fast_remove_line = fields.Boolean('Fast remove line', default=1)
    logo = fields.Binary('Receipt logo')
    paid_full = fields.Boolean('Allow paid full', default=0,
                               help='Allow cashiers click one button, do payment full order')
    paid_partial = fields.Boolean('Allow partial payment', default=0, help='Allow cashiers do partial payment')
    backup = fields.Boolean('Backup/Restore orders', default=0,
                            help='Allow cashiers backup and restore orders on pos screen')
    backup_orders = fields.Text('Backup orders', readonly=1)
    change_logo = fields.Boolean('Change logo', default=1, help='Allow cashiers change logo of shop on pos screen')
    management_session = fields.Boolean('Management cash control', default=0)
    barcode_receipt = fields.Boolean('Barcode receipt', default=0)

    hide_mobile = fields.Boolean('Hide mobile', default=1)
    hide_phone = fields.Boolean('Hide phone', default=1)
    hide_email = fields.Boolean('Hide email', default=1)
    update_client = fields.Boolean('Update client',
                                   help='Uncheck if you dont want cashier change customer information on pos')
    add_client = fields.Boolean('Add client', help='Uncheck if you dont want cashier add new customers on pos')
    remove_client = fields.Boolean('Remove client', help='Uncheck if you dont want cashier remove customers on pos')
    mobile_responsive = fields.Boolean('Mobile responsive', default=0)

    hide_amount_total = fields.Boolean('Hide amount total', default=1)
    hide_amount_taxes = fields.Boolean('Hide amount taxes', default=1)

    report_no_of_report = fields.Integer(string="No.of Copy Receipt", default=1)
    report_signature = fields.Boolean(string="Report Signature", default=0)

    report_product_summary = fields.Boolean(string="Report Product Summary", default=0)
    report_product_current_month_date = fields.Boolean(string="Report This Month", default=0)

    report_order_summary = fields.Boolean(string='Report Order Summary', default=0)
    report_order_current_month_date = fields.Boolean(string="Report Current Month", default=0)

    report_payment_summary = fields.Boolean(string="Report Payment Summary", default=0)
    report_payment_current_month_date = fields.Boolean(string="Payment Current Month", default=0)

    active_product_sort_by = fields.Boolean('Active product sort by', default=0)
    default_product_sort_by = fields.Selection([
        ('a_z', 'Sort from A to Z'),
        ('z_a', 'Sort from Z to A'),
        ('low_price', 'Sort from low to high price'),
        ('high_price', 'Sort from high to low price'),
        ('pos_sequence', 'Product pos sequence')
    ], string='Default sort by', default='a_z')
    add_customer_before_products_already_in_shopping_cart = fields.Boolean('Required add client first',
                                                                           help='Add customer before products \n'
                                                                                'already in shopping cart',
                                                                           default=0)
    allow_cashier_select_pricelist = fields.Boolean('Allow cashier use pricelist',
                                                    help='If uncheck, pricelist only work when select customer.\n'
                                                         ' Cashiers could not manual choose pricelist',
                                                    default=1)
    big_datas = fields.Boolean('Big datas',
                               help='If your system have large products and customers and when start session pos,\n'
                                    'and need many times for loading datas from backend.\n'
                                    ' This function can help cashier start pos few seconds',
                               default=1)
    sale_with_package = fields.Boolean('Sale with package')
    allow_set_price_smaller_min_price = fields.Boolean('Allow cashier set price smaller than public price', default=1)
    checking_lot = fields.Boolean('Validate lot/serial number',
                                  help='Validate lot name input by cashiers is wrong or correctly')

    sync_sales = fields.Boolean('Sync sales/quotations', default=1,
                                help='Synchronize quotations/sales order between backend and pos')
    rounding_total_paid = fields.Boolean('Rounding total paid',
                                         help='Rounding total paid amount of customer. \n'
                                              'Example: Total amount order is 19.6 USD \n'
                                              'and you set Decimal rounding of journal is 0.1,\n'
                                              ' Amount Paid customer is 20 USD',
                                         default=0)
    auto_nextscreen_when_validate_payment = fields.Boolean('Auto next screen when cashiers validated payment',
                                                           default=1)
    auto_print_web_receipt = fields.Boolean('Auto print web receipt', default=1)
    multi_lots = fields.Boolean('Multi lots', help='One order line can set many lots')
    create_lots = fields.Boolean('Create lots', help='Allow cashier create lots on pos')
    picking_delayed = fields.Boolean('Picking delayed', help='Allow picking auto create and process by cron job',
                                     default=0)
    promotion_ids = fields.Many2many('pos.promotion',
                                     'pos_config_promotion_rel',
                                     'config_id',
                                     'promotion_id',
                                     string='Promotions Applied')

    @api.multi
    def lock_session(self, vals):
        return self.sudo().write(vals)

    @api.model
    def switch_mobile_mode(self, config_id, vals):
        if vals.get('mobile_responsive') == True:
            vals['product_view'] = 'box'
        return self.browse(config_id).sudo().write(vals)

    @api.multi
    def reinstall_database(self):
        ###########################################################################################################
        # new field append :
        #                    - update param
        #                    - remove logs datas
        #                    - remove cache
        #                    - reload pos
        #                    - reinstall pos data
        # reinstall data button:
        #                    - remove all param
        #                    - pos start save param
        #                    - pos reinstall with new param
        # refresh call logs:
        #                    - get fields domain from param
        #                    - refresh data with new fields and domain
        ###########################################################################################################
        parameters = self.env['ir.config_parameter'].sudo().search([('key', 'in',
                                                                     ['product.product', 'res.partner',
                                                                      'account.invoice',
                                                                      'account.invoice.line', 'pos.order',
                                                                      'pos.order.line',
                                                                      'sale.order', 'sale.order.line'])])
        if parameters:
            parameters.sudo().unlink()
        self.env['pos.cache.database'].sudo().search([]).unlink()
        self.env['pos.call.log'].sudo().search([]).unlink()
        del_database_sql = ''' delete from pos_cache_database'''
        del_log_sql = ''' delete from pos_call_log'''
        self.env.cr.execute(del_database_sql)
        self.env.cr.execute(del_log_sql)
        self.env.cr.commit()
        return {
            'type': 'ir.actions.act_url',
            'url': '/pos/web/',
            'target': 'self',
        }

    @api.multi
    def remote_sessions(self):
        return {
            'name': _('Remote sessions'),
            'view_type': 'form',
            'target': 'new',
            'view_mode': 'form',
            'res_model': 'pos.remote.session',
            'view_id': False,
            'type': 'ir.actions.act_window',
            'context': {},
        }

    @api.multi
    def validate_and_post_entries_session(self):
        for config in self:
            sessions = self.env['pos.session'].search([('config_id', '=', config.id), ('state', '=', 'opened')])
            sessions.action_pos_session_closing_control()
            sessions.action_pos_session_validate()

    @api.onchange('lock_print_invoice_on_pos')
    def _onchange_lock_print_invoice_on_pos(self):
        if self.lock_print_invoice_on_pos == True:
            self.receipt_invoice_number = False
            self.send_invoice_email = True
        else:
            self.receipt_invoice_number = True
            self.send_invoice_email = False

    @api.onchange('receipt_invoice_number')
    def _onchange_receipt_invoice_number(self):
        if self.receipt_invoice_number == True:
            self.lock_print_invoice_on_pos = False
        else:
            self.lock_print_invoice_on_pos = True

    @api.onchange('pos_auto_invoice')
    def _onchange_pos_auto_invoice(self):
        if self.pos_auto_invoice == True:
            self.iface_invoicing = True
        else:
            self.iface_invoicing = False

    @api.onchange('staff_level')
    def on_change_staff_level(self):
        if self.staff_level and self.staff_level == 'manager':
            self.lock_order_printed_receipt = False

    @api.multi
    def write(self, vals):
        if vals.get('allow_discount', False) or vals.get('allow_qty', False) or vals.get('allow_price', False):
            vals['allow_numpad'] = True
        if vals.get('expired_days_voucher', None) and vals.get('expired_days_voucher') < 0:
            raise UserError('Expired days of voucher could not smaller than 0')
        for config in self:
            if vals.get('management_session', False) and not vals.get('default_cashbox_lines_ids'):
                if not config.default_cashbox_lines_ids and not config.cash_control:
                    raise UserError('Please go to Cash control and add Default Opening')
        res = super(pos_config, self).write(vals)
        for config in self:
            if config.validate_by_user_id and not config.validate_by_user_id.pos_security_pin:
                raise UserError(
                    'Validate user %s have not set pos security pin, please go to Users menu and input security password' % (
                        config.validate_by_user_id.name))
            if config.discount_unlock_limit_user_id and not config.discount_unlock_limit_user_id.pos_security_pin:
                raise UserError(
                    'User Unlock limit discount: %s ,have not set pos security pin, please go to Users menu and input security password' % (
                        config.discount_unlock_limit_user_id.name))
        return res

    @api.model
    def create(self, vals):
        if vals.get('allow_discount', False) or vals.get('allow_qty', False) or vals.get('allow_price', False):
            vals['allow_numpad'] = True
        if vals.get('expired_days_voucher', 0) < 0:
            raise UserError('Expired days of voucher could not smaller than 0')
        config = super(pos_config, self).create(vals)
        if config.management_session and not config.default_cashbox_lines_ids and not config.cash_control:
            raise UserError('Please go to Cash control and add Default Opening')
        if config.validate_by_user_id and not config.validate_by_user_id.pos_security_pin:
            raise UserError(
                'Validate user %s have not set pos security pin, please go to Users menu and input security password' % (
                    config.validate_by_user_id.name))
        if config.discount_unlock_limit_user_id and not config.discount_unlock_limit_user_id.pos_security_pin:
            raise UserError(
                'User Unlock limit discount: %s ,have not set pos security pin, please go to Users menu and input security password' % (
                    config.discount_unlock_limit_user_id.name))
        return config

    def init_wallet_journal(self):
        Journal = self.env['account.journal']
        user = self.env.user
        wallet_journal = Journal.sudo().search([
            ('code', '=', 'UWJ'),
            ('company_id', '=', user.company_id.id),
        ])
        if wallet_journal:
            return wallet_journal.sudo().write({
                'pos_method_type': 'wallet'
            })
        Account = self.env['account.account']
        wallet_account_old_version = Account.sudo().search([
            ('code', '=', 'AUW'), ('company_id', '=', user.company_id.id)])
        if wallet_account_old_version:
            wallet_account = wallet_account_old_version[0]
        else:
            wallet_account = Account.sudo().create({
                'name': 'Account wallet',
                'code': 'AUW',
                'user_type_id': self.env.ref('account.data_account_type_current_assets').id,
                'company_id': user.company_id.id,
                'note': 'code "AUW" auto give wallet amount of customers',
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'account_use_wallet' + str(user.company_id.id),
                'model': 'account.account',
                'module': 'pos_retail',
                'res_id': wallet_account.id,
                'noupdate': True,  # If it's False, target record (res_id) will be removed while module update
            })

        wallet_journal_inactive = Journal.sudo().search([
            ('code', '=', 'UWJ'),
            ('company_id', '=', user.company_id.id),
            ('pos_method_type', '=', 'wallet')
        ])
        if wallet_journal_inactive:
            wallet_journal_inactive.sudo().write({
                'default_debit_account_id': wallet_account.id,
                'default_credit_account_id': wallet_account.id,
                'pos_method_type': 'wallet',
                'sequence': 100,
            })
            wallet_journal = wallet_journal_inactive
        else:
            new_sequence = self.env['ir.sequence'].sudo().create({
                'name': 'Account Default Wallet Journal ' + str(user.company_id.id),
                'padding': 3,
                'prefix': 'UW ' + str(user.company_id.id),
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'journal_sequence' + str(new_sequence.id),
                'model': 'ir.sequence',
                'module': 'pos_retail',
                'res_id': new_sequence.id,
                'noupdate': True,
            })
            wallet_journal = Journal.sudo().create({
                'name': 'Wallet',
                'code': 'UWJ',
                'type': 'cash',
                'pos_method_type': 'wallet',
                'journal_user': True,
                'sequence_id': new_sequence.id,
                'company_id': user.company_id.id,
                'default_debit_account_id': wallet_account.id,
                'default_credit_account_id': wallet_account.id,
                'sequence': 100,
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'use_wallet_journal_' + str(wallet_journal.id),
                'model': 'account.journal',
                'module': 'pos_retail',
                'res_id': int(wallet_journal.id),
                'noupdate': True,
            })

        config = self
        config.sudo().write({
            'journal_ids': [(4, wallet_journal.id)],
        })

        statement = [(0, 0, {
            'journal_id': wallet_journal.id,
            'user_id': user.id,
            'company_id': user.company_id.id
        })]
        current_session = config.current_session_id
        current_session.sudo().write({
            'statement_ids': statement,
        })
        return

    def init_voucher_journal(self):
        Journal = self.env['account.journal']
        user = self.env.user
        voucher_journal = Journal.sudo().search([
            ('code', '=', 'VCJ'),
            ('company_id', '=', user.company_id.id),
        ])
        if voucher_journal:
            return voucher_journal.sudo().write({
                'pos_method_type': 'voucher'
            })
        Account = self.env['account.account']
        voucher_account_old_version = Account.sudo().search([
            ('code', '=', 'AVC'), ('company_id', '=', user.company_id.id)])
        if voucher_account_old_version:
            voucher_account = voucher_account_old_version[0]
        else:
            voucher_account = Account.sudo().create({
                'name': 'Account voucher',
                'code': 'AVC',
                'user_type_id': self.env.ref('account.data_account_type_current_assets').id,
                'company_id': user.company_id.id,
                'note': 'code "AVC" auto give voucher histories of customers',
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'account_voucher' + str(user.company_id.id),
                'model': 'account.account',
                'module': 'pos_retail',
                'res_id': voucher_account.id,
                'noupdate': True,  # If it's False, target record (res_id) will be removed while module update
            })

        voucher_journal = Journal.sudo().search([
            ('code', '=', 'VCJ'),
            ('company_id', '=', user.company_id.id),
            ('pos_method_type', '=', 'voucher')
        ])
        if voucher_journal:
            voucher_journal[0].sudo().write({
                'voucher': True,
                'default_debit_account_id': voucher_account.id,
                'default_credit_account_id': voucher_account.id,
                'pos_method_type': 'voucher',
                'sequence': 101,
            })
            voucher_journal = voucher_journal[0]
        else:
            new_sequence = self.env['ir.sequence'].sudo().create({
                'name': 'Account Voucher ' + str(user.company_id.id),
                'padding': 3,
                'prefix': 'AVC ' + str(user.company_id.id),
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'journal_sequence' + str(new_sequence.id),
                'model': 'ir.sequence',
                'module': 'pos_retail',
                'res_id': new_sequence.id,
                'noupdate': True,
            })
            voucher_journal = Journal.sudo().create({
                'name': 'Voucher',
                'code': 'VCJ',
                'type': 'cash',
                'pos_method_type': 'voucher',
                'journal_user': True,
                'sequence_id': new_sequence.id,
                'company_id': user.company_id.id,
                'default_debit_account_id': voucher_account.id,
                'default_credit_account_id': voucher_account.id,
                'sequence': 101,
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'journal_voucher_' + str(voucher_journal.id),
                'model': 'account.journal',
                'module': 'pos_retail',
                'res_id': int(voucher_journal.id),
                'noupdate': True,
            })

        config = self
        config.sudo().write({
            'journal_ids': [(4, voucher_journal.id)],
        })

        statement = [(0, 0, {
            'journal_id': voucher_journal.id,
            'user_id': user.id,
            'company_id': user.company_id.id
        })]
        current_session = config.current_session_id
        current_session.sudo().write({
            'statement_ids': statement,
        })
        return

    def init_credit_journal(self):
        Journal = self.env['account.journal']
        user = self.env.user
        voucher_journal = Journal.sudo().search([
            ('code', '=', 'CJ'),
            ('company_id', '=', user.company_id.id),
        ])
        if voucher_journal:
            return voucher_journal.sudo().write({
                'pos_method_type': 'credit'
            })
        Account = self.env['account.account']
        credit_account_old_version = Account.sudo().search([
            ('code', '=', 'ACJ'), ('company_id', '=', user.company_id.id)])
        if credit_account_old_version:
            credit_account = credit_account_old_version[0]
        else:
            credit_account = Account.sudo().create({
                'name': 'Credit Account',
                'code': 'CA',
                'user_type_id': self.env.ref('account.data_account_type_current_assets').id,
                'company_id': user.company_id.id,
                'note': 'code "CA" give credit payment customer',
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'account_credit' + str(user.company_id.id),
                'model': 'account.account',
                'module': 'pos_retail',
                'res_id': credit_account.id,
                'noupdate': True,  # If it's False, target record (res_id) will be removed while module update
            })

        credit_journal = Journal.sudo().search([
            ('code', '=', 'CJ'),
            ('company_id', '=', user.company_id.id),
            ('pos_method_type', '=', 'credit')
        ])
        if credit_journal:
            credit_journal[0].sudo().write({
                'credit': True,
                'default_debit_account_id': credit_account.id,
                'default_credit_account_id': credit_account.id,
                'pos_method_type': 'credit',
                'sequence': 102,
            })
            credit_journal = credit_journal[0]
        else:
            new_sequence = self.env['ir.sequence'].sudo().create({
                'name': 'Credit account ' + str(user.company_id.id),
                'padding': 3,
                'prefix': 'CA ' + str(user.company_id.id),
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'journal_sequence' + str(new_sequence.id),
                'model': 'ir.sequence',
                'module': 'pos_retail',
                'res_id': new_sequence.id,
                'noupdate': True,
            })
            credit_journal = Journal.sudo().create({
                'name': 'Customer Credit',
                'code': 'CJ',
                'type': 'cash',
                'pos_method_type': 'credit',
                'journal_user': True,
                'sequence_id': new_sequence.id,
                'company_id': user.company_id.id,
                'default_debit_account_id': credit_account.id,
                'default_credit_account_id': credit_account.id,
                'sequence': 102,
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'credit_journal_' + str(credit_journal.id),
                'model': 'account.journal',
                'module': 'pos_retail',
                'res_id': int(credit_journal.id),
                'noupdate': True,
            })

        config = self
        config.sudo().write({
            'journal_ids': [(4, credit_journal.id)],
        })

        statement = [(0, 0, {
            'journal_id': credit_journal.id,
            'user_id': user.id,
            'company_id': user.company_id.id
        })]
        current_session = config.current_session_id
        current_session.sudo().write({
            'statement_ids': statement,
        })
        return True

    def init_return_order_journal(self):
        Journal = self.env['account.journal']
        user = self.env.user
        return_journal = Journal.sudo().search([
            ('code', '=', 'ROJ'),
            ('company_id', '=', user.company_id.id),
        ])
        if return_journal:
            return return_journal.sudo().write({
                'pos_method_type': 'return'
            })
        Account = self.env['account.account']
        return_account_old_version = Account.sudo().search([
            ('code', '=', 'ARO'), ('company_id', '=', user.company_id.id)])
        if return_account_old_version:
            return_account = return_account_old_version[0]
        else:
            return_account = Account.sudo().create({
                'name': 'Return Order Account',
                'code': 'ARO',
                'user_type_id': self.env.ref('account.data_account_type_current_assets').id,
                'company_id': user.company_id.id,
                'note': 'code "ARO" give return order from customer',
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'return_account' + str(user.company_id.id),
                'model': 'account.account',
                'module': 'pos_retail',
                'res_id': return_account.id,
                'noupdate': True,  # If it's False, target record (res_id) will be removed while module update
            })

        return_journal = Journal.sudo().search([
            ('code', '=', 'ROJ'),
            ('company_id', '=', user.company_id.id),
        ])
        if return_journal:
            return_journal[0].sudo().write({
                'default_debit_account_id': return_account.id,
                'default_credit_account_id': return_account.id,
                'pos_method_type': 'return'
            })
            return_journal = return_journal[0]
        else:
            new_sequence = self.env['ir.sequence'].sudo().create({
                'name': 'Return account ' + str(user.company_id.id),
                'padding': 3,
                'prefix': 'RA ' + str(user.company_id.id),
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'journal_sequence' + str(new_sequence.id),
                'model': 'ir.sequence',
                'module': 'pos_retail',
                'res_id': new_sequence.id,
                'noupdate': True,
            })
            return_journal = Journal.sudo().create({
                'name': 'Return Order Customer',
                'code': 'ROJ',
                'type': 'cash',
                'pos_method_type': 'return',
                'journal_user': True,
                'sequence_id': new_sequence.id,
                'company_id': user.company_id.id,
                'default_debit_account_id': return_account.id,
                'default_credit_account_id': return_account.id,
                'sequence': 103,
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'return_journal_' + str(return_journal.id),
                'model': 'account.journal',
                'module': 'pos_retail',
                'res_id': int(return_journal.id),
                'noupdate': True,
            })

        config = self
        config.sudo().write({
            'journal_ids': [(4, return_journal.id)],
        })

        statement = [(0, 0, {
            'journal_id': return_journal.id,
            'user_id': user.id,
            'company_id': user.company_id.id
        })]
        current_session = config.current_session_id
        current_session.sudo().write({
            'statement_ids': statement,
        })
        return True

    def init_rounding_journal(self):
        Journal = self.env['account.journal']
        Account = self.env['account.account']
        user = self.env.user
        rounding_journal = Journal.sudo().search([
            ('code', '=', 'RDJ'),
            ('company_id', '=', user.company_id.id),
        ])
        if rounding_journal:
            return rounding_journal.sudo().write({
                'pos_method_type': 'rounding'
            })
        rounding_account_old_version = Account.sudo().search([
            ('code', '=', 'AAR'), ('company_id', '=', user.company_id.id)])
        if rounding_account_old_version:
            rounding_account = rounding_account_old_version[0]
        else:
            rounding_account = Account.sudo().create({
                'name': 'Rounding Account',
                'code': 'AAR',
                'user_type_id': self.env.ref('account.data_account_type_current_assets').id,
                'company_id': user.company_id.id,
                'note': 'code "AAR" give rounding pos order',
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'rounding_account' + str(user.company_id.id),
                'model': 'account.account',
                'module': 'pos_retail',
                'res_id': rounding_account.id,
                'noupdate': True,
            })
        rounding_journal = Journal.sudo().search([
            ('pos_method_type', '=', 'rounding'),
            ('company_id', '=', user.company_id.id),
        ])
        if rounding_journal:
            rounding_journal[0].sudo().write({
                'name': 'Rounding',
                'default_debit_account_id': rounding_account.id,
                'default_credit_account_id': rounding_account.id,
                'pos_method_type': 'rounding',
                'code': 'RDJ'
            })
            rounding_journal = rounding_journal[0]
        else:
            new_sequence = self.env['ir.sequence'].sudo().create({
                'name': 'rounding account ' + str(user.company_id.id),
                'padding': 3,
                'prefix': 'RA ' + str(user.company_id.id),
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'journal_sequence' + str(new_sequence.id),
                'model': 'ir.sequence',
                'module': 'pos_retail',
                'res_id': new_sequence.id,
                'noupdate': True,
            })
            rounding_journal = Journal.sudo().create({
                'name': 'Rounding',
                'code': 'RDJ',
                'type': 'cash',
                'pos_method_type': 'rounding',
                'journal_user': True,
                'sequence_id': new_sequence.id,
                'company_id': user.company_id.id,
                'default_debit_account_id': rounding_account.id,
                'default_credit_account_id': rounding_account.id,
                'sequence': 103,
            })
            self.env['ir.model.data'].sudo().create({
                'name': 'rounding_journal_' + str(rounding_journal.id),
                'model': 'account.journal',
                'module': 'pos_retail',
                'res_id': int(rounding_journal.id),
                'noupdate': True,
            })

        config = self
        config.sudo().write({
            'journal_ids': [(4, rounding_journal.id)],
        })

        statement = [(0, 0, {
            'journal_id': rounding_journal.id,
            'user_id': user.id,
            'company_id': user.company_id.id
        })]
        current_session = config.current_session_id
        current_session.sudo().write({
            'statement_ids': statement,
        })
        return True

    @api.multi
    def open_ui(self):
        res = super(pos_config, self).open_ui()
        self.init_voucher_journal()
        self.init_wallet_journal()
        self.init_credit_journal()
        self.init_return_order_journal()
        self.init_rounding_journal()
        return res

    @api.multi
    def open_session_cb(self):
        res = super(pos_config, self).open_session_cb()
        self.init_voucher_journal()
        self.init_wallet_journal()
        self.init_credit_journal()
        self.init_return_order_journal()
        self.init_rounding_journal()
        return res
