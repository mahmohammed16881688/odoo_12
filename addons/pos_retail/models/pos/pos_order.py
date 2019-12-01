# -*- coding: utf-8 -*-
from odoo import api, fields, models, tools, _, registry
from odoo.tools import DEFAULT_SERVER_DATETIME_FORMAT
import odoo
import logging
import openerp.addons.decimal_precision as dp
from odoo.exceptions import UserError
from datetime import datetime, timedelta
import threading

_logger = logging.getLogger(__name__)


class pos_order(models.Model):
    _inherit = "pos.order"

    picking_ids = fields.One2many('stock.picking', 'pos_order_id', 'Delivery Orders')
    promotion_ids = fields.Many2many('pos.promotion',
                                     'pos_order_promotion_rel',
                                     'order_id',
                                     'promotion_id',
                                     string='Promotions')
    ean13 = fields.Char('Ean13')
    expire_date = fields.Datetime('Expired date')
    is_return = fields.Boolean('Is return')
    add_credit = fields.Boolean('Add credit')
    lock_return = fields.Boolean('Lock return')
    return_order_id = fields.Many2one('pos.order', 'Return of order')
    email = fields.Char('Email')
    email_invoice = fields.Boolean('Email invoice')
    mrp_order_ids = fields.One2many('mrp.production', 'pos_id', 'Manufacturing orders', readonly=1)
    plus_point = fields.Float(compute="_get_point", styring='Plus point')
    redeem_point = fields.Float(compute="_get_point", styring='Redeem point')
    signature = fields.Binary('Signature', readonly=1)
    invoice_journal_id = fields.Many2one('account.journal', 'Journal account', readonly=1)
    parent_id = fields.Many2one('pos.order', 'Parent Order', readonly=1)
    sale_id = fields.Many2one('sale.order', 'Sale order', readonly=1)
    create_voucher = fields.Boolean('Credit voucher', readonly=1)
    partial_payment = fields.Boolean('Partial Payment')
    state = fields.Selection(selection_add=[
        ('partial_payment', 'Partial Payment')
    ])
    medical_insurance_id = fields.Many2one('medical.insurance', 'Medical insurance')
    margin = fields.Float(
        'Margin', compute='_compute_margin', store=True,
        digits=dp.get_precision('Product Price'))
    location_id = fields.Many2one('stock.location', string="Location", required=True, related=False, readonly=0)
    lines = fields.One2many('pos.order.line', 'order_id', string='Order Lines',
                            states={'draft': [('readonly', False)], 'partial_payment': [('readonly', False)]},
                            readonly=True, copy=True)
    booking_id = fields.Many2one('sale.order', 'Booking order',
                                 help='This order covert from booking (quotation/sale) order', readonly=1)
    picking_delayed = fields.Boolean('Picking delayed', readonly=1)

    @api.multi
    @api.depends('lines.margin')
    def _compute_margin(self):
        for order in self:
            order.margin = sum(order.mapped('lines.margin'))

    @api.multi
    def unlink(self):
        for record in self:
            self.env['pos.cache.database'].remove_record(self._inherit, record.id)
        return super(pos_order, self).unlink()

    @api.multi
    def write(self, vals):
        res = super(pos_order, self).write(vals)
        for order in self:
            if vals.get('state', False) == 'paid':
                for line in order.lines:
                    vouchers = self.env['pos.voucher'].search([('pos_order_line_id', '=', line.id)])
                    vouchers.write({'state': 'active'})  # active vouchers for customers can use, required paid done
            if order.partner_id:  # sync credit, wallet balance to pos sessions
                self.env['pos.cache.database'].insert_data('res.partner', order.partner_id.id)
            self.env['pos.cache.database'].insert_data(self._inherit, order.id)
        return res

    @api.model
    def create(self, vals):
        order = super(pos_order, self).create(vals)
        if vals.get('partial_payment', False):
            order.write({'state': 'partial_payment'})
        if order.create_voucher:
            self.env['pos.voucher'].create_voucher(order)
        if vals.get('booking_id', False):
            booked_order = self.env['sale.order'].browse(vals.get('booking_id'))
            booked_order.write({'state': 'booked'})
        self.env['pos.cache.database'].insert_data(self._inherit, order.id)
        return order

    @api.multi
    def action_pos_order_send(self):
        if not self.partner_id:
            raise Warning(_('Customer not found on this Point of Sale Orders.'))
        self.ensure_one()
        template = self.env.ref('pos_retail.email_template_edi_pos_orders', False)
        compose_form = self.env.ref('mail.email_compose_message_wizard_form', False)
        ctx = dict(
            default_model='pos.order',
            default_res_id=self.id,
            default_use_template=bool(template),
            default_template_id=template and template.id or False,
            default_composition_mode='comment',
        )
        return {
            'name': _('Compose Email'),
            'type': 'ir.actions.act_window',
            'view_type': 'form',
            'view_mode': 'form',
            'res_model': 'mail.compose.message',
            'views': [(compose_form.id, 'form')],
            'view_id': compose_form.id,
            'target': 'new',
            'context': ctx,
        }

    def _prepare_invoice(self):
        values = super(pos_order, self)._prepare_invoice()
        if self.invoice_journal_id:
            values['journal_id'] = self.invoice_journal_id.id
        return values

    @api.one
    def made_invoice(self):
        self.action_pos_order_invoice()
        self.invoice_id.sudo().action_invoice_open()
        self.account_move = self.invoice_id.move_id
        return {
            'id': self.invoice_id.id,
            'number': self.invoice_id.number
        }

    @api.multi
    def _get_point(self):
        for order in self:
            order.plus_point = 0
            order.redeem_point = 0
            for line in order.lines:
                order.plus_point += line.plus_point
                order.redeem_point += line.redeem_point

    def add_payment(self, data):
        # v12 check data have currency_id, will check company currency and line currency
        # if have not difference could not create
        if data.get('currency_id', False):
            currency = self.env['res.currency'].browse(data.get('currency_id'))
            if currency == self.env.user.company_id.currency_id:
                del data['currency_id']
                del data['amount_currency']
        res = super(pos_order, self).add_payment(data)
        self.env['pos.cache.database'].insert_data(self._inherit, self.id)
        return res

    # method use for force picking done, function pos internal mode
    @api.model
    def pos_force_picking_done(self, picking_id):
        picking = self.env['stock.picking'].browse(picking_id)
        picking.action_assign()
        picking.force_assign()
        wrong_lots = self.set_pack_operation_lot(picking)
        if not wrong_lots:
            picking.action_done()

    def _action_create_invoice_line(self, line=False, invoice_id=False):
        # when cashiers change tax on pos order line (pos screen)
        # map pos.order.line to account.invoice.line
        # map taxes of pos.order.line to account.invoice.line
        inv_line = super(pos_order, self)._action_create_invoice_line(line, invoice_id)
        vals = {
            'pos_line_id': line.id
        }
        if not line.order_id.fiscal_position_id:
            tax_ids = [tax.id for tax in line.tax_ids]
            vals.update({
                'invoice_line_tax_ids': [(6, 0, tax_ids)]
            })
        if line.uom_id:
            vals.update({
                'uom_id': line.uom_id.id
            })
        inv_line.write(vals)
        return inv_line

    # create 1 purchase get products return from customer
    def made_purchase_order(self):
        customer_return = self.env['res.partner'].search([('name', '=', 'Customer return')])
        po = self.env['purchase.order'].create({
            'partner_id': self.partner_id.id if self.partner_id else customer_return[0].id,
            'name': 'Return/' + self.name,
        })
        for line in self.lines:
            if line.qty < 0:
                self.env['purchase.order.line'].create({
                    'order_id': po.id,
                    'name': 'Return/' + line.product_id.name,
                    'product_id': line.product_id.id,
                    'product_qty': - line.qty,
                    'product_uom': line.product_id.uom_po_id.id,
                    'price_unit': line.price_unit,
                    'date_planned': datetime.today().strftime(DEFAULT_SERVER_DATETIME_FORMAT),
                })
        po.button_confirm()
        for picking in po.picking_ids:
            picking.action_assign()
            picking.force_assign()
            wrong_lots = self.set_pack_operation_lot(picking)
            if not wrong_lots:
                picking.action_done()
        return True

    @api.multi
    def set_done(self):
        for order in self:
            order.write({'state': 'done'})

    @api.model
    def _order_fields(self, ui_order):
        order_fields = super(pos_order, self)._order_fields(ui_order)
        if ui_order.get('add_credit', False):
            order_fields.update({
                'add_credit': ui_order['add_credit']
            })
        if ui_order.get('medical_insurance_id', False):
            order_fields.update({
                'medical_insurance_id': ui_order['medical_insurance_id']
            })
        if ui_order.get('partial_payment', False):
            order_fields.update({
                'partial_payment': ui_order['partial_payment']
            })
        if ui_order.get('sale_id', False):
            order_fields.update({
                'sale_id': ui_order['sale_id']
            })
        if ui_order.get('delivery_date', False):
            order_fields.update({
                'delivery_date': ui_order['delivery_date']
            })
        if ui_order.get('delivery_address', False):
            order_fields.update({
                'delivery_address': ui_order['delivery_address']
            })
        if ui_order.get('parent_id', False):
            order_fields.update({
                'parent_id': ui_order['parent_id']
            })
        if ui_order.get('invoice_journal_id', False):
            order_fields['invoice_journal_id'] = ui_order.get('invoice_journal_id')
        if ui_order.get('ean13', False):
            order_fields.update({
                'ean13': ui_order['ean13']
            })
        if ui_order.get('expire_date', False):
            order_fields.update({
                'expire_date': ui_order['expire_date']
            })
        if ui_order.get('is_return', False):
            order_fields.update({
                'is_return': ui_order['is_return']
            })
        if ui_order.get('email', False):
            order_fields.update({
                'email': ui_order.get('email')
            })
        if ui_order.get('email_invoice', False):
            order_fields.update({
                'email_invoice': ui_order.get('email_invoice')
            })
        if ui_order.get('create_voucher', False):
            order_fields.update({
                'create_voucher': ui_order.get('create_voucher')
            })
        if ui_order.get('plus_point', 0):
            order_fields.update({
                'plus_point': ui_order['plus_point']
            })
        if ui_order.get('redeem_point', 0):
            order_fields.update({
                'redeem_point': ui_order['redeem_point']
            })
        if ui_order.get('note', None):
            order_fields.update({
                'note': ui_order['note']
            })
        if ui_order.get('return_order_id', False):
            order_fields.update({
                'return_order_id': ui_order['return_order_id']
            })
        if ui_order.get('location_id', False):
            order_fields.update({
                'location_id': ui_order['location_id']
            })
        if ui_order.get('booking_id', False):
            order_fields.update({
                'booking_id': ui_order['booking_id']
            })
        if ui_order.get('picking_delayed', False):
            order_fields.update({'picking_delayed': True})
        return order_fields

    @api.model
    def get_code(self, code):
        return self.env['barcode.nomenclature'].sudo().sanitize_ean(code)

    def _action_create_invoice_line_return(self, line=False, invoice_id=False):
        InvoiceLine = self.env['account.invoice.line']
        inv_name = line.product_id.name_get()[0][1]
        inv_line = {
            'invoice_id': invoice_id,
            'product_id': line.product_id.id,
            'quantity': - line.qty,
            'account_analytic_id': self._prepare_analytic_account(line),
            'name': inv_name,
        }
        if line.qty < 0:
            inv_line['qty'] = - line.qty
        else:
            inv_line['qty'] = line.qty
        invoice_line = InvoiceLine.sudo().new(inv_line)
        invoice_line._onchange_product_id()
        invoice_line.invoice_line_tax_ids = invoice_line.invoice_line_tax_ids.filtered(
            lambda t: t.company_id.id == line.order_id.company_id.id).ids
        fiscal_position_id = line.order_id.fiscal_position_id
        if fiscal_position_id:
            invoice_line.invoice_line_tax_ids = fiscal_position_id.map_tax(invoice_line.invoice_line_tax_ids,
                                                                           line.product_id, line.order_id.partner_id)
        invoice_line.invoice_line_tax_ids = invoice_line.invoice_line_tax_ids.ids
        inv_line = invoice_line._convert_to_write({name: invoice_line[name] for name in invoice_line._cache})
        inv_line.update(price_unit=line.price_unit, discount=line.discount, name=inv_name)
        return InvoiceLine.sudo().create(inv_line)

    @api.model
    def create_from_ui(self, orders):
        order_to_invoice = []
        for o in orders:
            data = o['data']
            pos_session_id = data['pos_session_id']
            config = self.env['pos.session'].browse(pos_session_id).config_id
            to_invoice = o.get('to_invoice', False)
            if to_invoice and not data.get('partner_id', None):
                raise UserError(_('Please provide a partner for the sale.'))
            if to_invoice and data.get('partner_id', None) and config.invoice_offline:
                o['to_invoice'] = False
                order_to_invoice.append(data.get('name'))
            lines = data.get('lines')
            for line_val in lines:
                line = line_val[2]
                new_line = {}
                for key, value in line.items():
                    if key not in [
                        'creation_time',
                        'mp_dirty',
                        'mp_skip',
                        'quantity_wait',
                        'state',
                        'tags',
                        'quantity_done',
                        'promotion_discount_total_order',
                        'promotion_discount_category',
                        'promotion_discount_by_quantity',
                        'promotion_discount',
                        'promotion_gift',
                        'promotion_price_by_quantity']:
                        new_line[key] = value
                line_val[2] = new_line
        order_ids = super(pos_order, self.with_context(
                    picking_delayed=True)).create_from_ui(orders)
        pos_orders = self.browse(order_ids)
        for order in pos_orders:
            order.pos_compute_loyalty_point()
            self.create_picking_with_multi_variant(orders, order)
            self.create_picking_combo(orders, order)
            self.pos_made_manufacturing_order(order)
            """
                * auto send email and receipt to customers
            """
            invoices = self.env['account.invoice'].search([('origin', '=', order.name)])
            if order.email and order.email_invoice and invoices:
                for inv in invoices:
                    inv.send_email_invoice(order)
            if order.add_credit and order.amount_total < 0:
                order.add_credit(- order.amount_total)
            if order.partner_id and order.config_id.invoice_offline and order.pos_reference in order_to_invoice:
                self.env.cr.commit()
                threaded_synchronization = threading.Thread(target=self.auto_invoice, args=(
                    order.id, []))
                threaded_synchronization.start()
            if order.partner_id and not order.config_id.invoice_offline and order.config_id.auto_register_payment:
                self.env.cr.commit()
                threaded_synchronization = threading.Thread(target=self.auto_auto_register_payment_invoice, args=(
                    order.id, []))
                threaded_synchronization.start()
        return order_ids

    def create_picking(self): # we remove orders have picking delayed is true. only process realtime with picking delayed is false
        if self.env.context.get('picking_delayed', False):
            orders = self.filtered(lambda x: not x.picking_delayed)
        else:
            orders = self
        res = super(pos_order, orders).create_picking()
        return res

    @api.multi
    def cron_job_auto_create_picking_delayed(self):
        _logger.info('Begin cron_job_auto_create_picking_delayed()')
        orders = self.search([
            ('state', '!=', 'draft'),
            ('picking_delayed', '=', True),
            ('picking_id', '=', None)
        ], order='date_order')
        for order in orders:
            order.sudo(order.user_id.id).with_context(
                force_company=order.company_id.id).create_picking()
            order.write({'picking_delayed': False})
            _logger.info("Created picking for order ean13: %s" % (order.ean13))
        return True

    @api.multi
    def auto_invoice(self, order_id, order_ids=[]):
        with api.Environment.manage():
            """
                * auto create invoice
            """
            new_cr = registry(self._cr.dbname).cursor()
            self = self.with_env(self.env(cr=new_cr))
            pos_order = self.browse(order_id)
            pos_order.action_pos_order_invoice()
            pos_order.invoice_id.sudo().action_invoice_open()
            pos_order.account_move = pos_order.invoice_id.move_id
            if pos_order.config_id.auto_register_payment:
                pos_order.pos_order_auto_invoice_reconcile()
            new_cr.commit()
            new_cr.close()
        return True

    @api.multi
    def auto_auto_register_payment_invoice(self, order_id, order_ids=[]):
        with api.Environment.manage():
            """
                * auto reconcile invoice if auto_register_payment checked on pos config
            """
            new_cr = registry(self._cr.dbname).cursor()
            self = self.with_env(self.env(cr=new_cr))
            pos_order = self.browse(order_id)
            pos_order.pos_order_auto_invoice_reconcile()
            new_cr.commit()
            new_cr.close()
        return True

    def pos_made_manufacturing_order(self, order):
        """
            * pos create mrp order
            * if have bill of material config for product
        """
        version_info = odoo.release.version_info
        for line in order.lines:
            product_template = line.product_id.product_tmpl_id
            if not product_template.manufacturing_out_of_stock:
                continue
            else:
                mrp_orders = self.env['mrp.production'].sudo().search([('name', '=', order.name)])
                if mrp_orders or not order.session_id.config_id.stock_location_id:
                    continue
                else:
                    quantity_available = 0
                    bom = product_template.bom_id
                    product_id = line.product_id.id
                    location_id = order.session_id.config_id.stock_location_id.id
                    quants = self.env['stock.quant'].search(
                        [('product_id', '=', product_id), ('location_id', '=', location_id)])
                    if quants:
                        quantity_available = 0
                        if version_info and version_info[0] in [11, 12]:
                            quantity_available = sum([q.quantity for q in quants])
                        if version_info and version_info[0] == 10:
                            quantity_available = sum([q.qty for q in quants])
                    pos_min_qty = product_template.pos_min_qty
                    if quantity_available <= pos_min_qty:
                        pos_manufacturing_quantity = product_template.pos_manufacturing_quantity
                        vals = {
                            'name': self.name,
                            'product_id': line.product_id.id,
                            'product_qty': pos_manufacturing_quantity,
                            'bom_id': bom.id,
                            'product_uom_id': bom.product_uom_id.id if bom.product_uom_id else line.product_id.uom_id.id,
                            'pos_id': self.id,
                            'origin': self.name,
                            'pos_user_id': self.env.user.id,
                        }
                        try:
                            mrp_order = self.env['mrp.production'].create(vals)
                            if product_template.manufacturing_state == 'manual':
                                mrp_order.action_assign()
                            if product_template.manufacturing_state == 'auto':
                                mrp_order.action_assign()
                                mrp_order.button_plan()
                                work_orders = self.env['mrp.workorder'].search([('production_id', '=', mrp_order.id)])
                                if work_orders:
                                    work_orders.button_start()
                                    work_orders.record_production()
                                else:
                                    produce_wizard = self.env['mrp.product.produce'].with_context({
                                        'active_id': mrp_order.id,
                                        'active_ids': [mrp_order.id],
                                    }).create({
                                        'product_qty': pos_manufacturing_quantity,
                                    })
                                    produce_wizard.do_produce()
                                mrp_order.button_mark_done()
                        except:
                            continue
        return True

    def pos_compute_loyalty_point(self):
        """
            * auto update customer point of loyalty program
        """
        if self.partner_id:
            pos_loyalty_point = self.partner_id.pos_loyalty_point
            if self.plus_point:
                pos_loyalty_point += self.plus_point
            if self.redeem_point:
                pos_loyalty_point += self.redeem_point
            loyalty_categories = self.env['pos.loyalty.category'].search([])
            pos_loyalty_type = self.partner_id.pos_loyalty_type.id if self.partner_id.pos_loyalty_type else None
            for loyalty_category in loyalty_categories:
                if pos_loyalty_point >= loyalty_category.from_point and pos_loyalty_point <= loyalty_category.to_point:
                    pos_loyalty_type = loyalty_category.id
            return self.partner_id.sudo().write(
                {'pos_loyalty_point': pos_loyalty_point, 'pos_loyalty_type': pos_loyalty_type})
        else:
            return False

    @api.model
    def add_credit(self, amount):
        """
            * create credit note for return order
        """

        if self.partner_id:
            credit_object = self.env['res.partner.credit']
            credit = credit_object.create({
                'name': self.name,
                'type': 'plus',
                'amount': amount,
                'pos_order_id': self.id,
                'partner_id': self.partner_id.id,
            })
            return self.env['pos.cache.database'].insert_data('res.partner', credit.partner_id.id)
        else:
            return False

    @api.multi
    def pos_order_auto_invoice_reconcile(self):
        version_info = odoo.release.version_info
        if version_info and version_info[0] in [11, 12]:
            for order_obj in self:
                if order_obj.invoice_id:
                    moves = self.env['account.move']
                    statements_line_ids = order_obj.statement_ids
                    for st_line in statements_line_ids:
                        if st_line.account_id and not st_line.journal_entry_ids.ids:
                            st_line.fast_counterpart_creation()
                        elif not st_line.journal_entry_ids.ids and not st_line.currency_id.is_zero(st_line.amount):
                            break
                        for aml in st_line.journal_entry_ids:
                            moves |= aml.move_id
                        if moves:
                            moves.filtered(lambda m: m.state != 'posted').post()
                        for move in moves:
                            for line_id in move.line_ids:
                                if line_id.credit_cash_basis > 0:
                                    not line_id.reconciled and order_obj.invoice_id.assign_outstanding_credit(
                                        line_id.id)
        return True

    def create_picking_combo(self, orders, order):
        version_info = odoo.release.version_info
        for o in orders:
            warehouse_obj = self.env['stock.warehouse']
            move_object = self.env['stock.move']
            picking_obj = self.env['stock.picking']
            product_obj = self.env['product.product']
            if o['data']['name'] == order.pos_reference:
                combo_items = []
                picking_type = order.picking_type_id
                if not picking_type:
                    continue
                location_id = order.location_id.id
                address = order.partner_id.address_get(['delivery']) or {}
                if order.partner_id:
                    destination_id = order.partner_id.property_stock_customer.id
                else:
                    if (not picking_type) or (not picking_type.default_location_dest_id):
                        customerloc, supplierloc = warehouse_obj._get_partner_locations()
                        destination_id = customerloc.id
                    else:
                        destination_id = picking_type.default_location_dest_id.id
                if o['data'] and o['data'].get('lines', []):
                    for line in o['data']['lines']:
                        line = line[2]
                        if line and line.get('combo_items', []):
                            for item in line['combo_items']:
                                item['quantity'] = item['quantity'] * line['qty']
                                combo_items.append(item)
                            del line['combo_items']
                if combo_items:
                    picking_vals = {
                        'name': order.name + '/Combo',
                        'origin': order.name,
                        'partner_id': address.get('delivery', False),
                        'date_done': order.date_order,
                        'picking_type_id': picking_type.id,
                        'company_id': order.company_id.id,
                        'move_type': 'direct',
                        'note': order.note or "",
                        'location_id': location_id,
                        'location_dest_id': destination_id,
                        'pos_order_id': order.id,
                    }
                    order_picking = picking_obj.create(picking_vals)
                    for item in combo_items:
                        product = product_obj.browse(item['product_id'][0])
                        move_vals = {
                            'name': order.name,
                            'product_uom': item['uom_id'][0] if item['uom_id'] else product.uom_id.id,
                            'picking_id': order_picking.id,
                            'picking_type_id': picking_type.id,
                            'product_id': product.id,
                            'product_uom_qty': abs(item['quantity']),
                            'state': 'draft',
                            'location_id': location_id,
                            'location_dest_id': destination_id,
                        }
                        move = move_object.create(move_vals)
                        if item.get('lot_number', None):
                            self.create_stock_move_with_lot(move, item['lot_number'])
                    order_picking.action_assign()
                    if version_info and version_info[0] in [10, 11]:
                        order_picking.force_assign()
                    wiz = None
                    if version_info and version_info[0] in [11, 12]:
                        wiz = self.env['stock.immediate.transfer'].create({'pick_ids': [(4, order_picking.id)]})
                    if version_info and version_info[0] == 10:
                        wiz = self.env['stock.immediate.transfer'].create({'pick_id': order_picking.id})
                    if wiz:
                        wiz.process()
        return True

    def create_picking_with_multi_variant(self, orders, order):
        for o in orders:
            warehouse_obj = self.env['stock.warehouse']
            move_object = self.env['stock.move']
            moves = move_object
            picking_obj = self.env['stock.picking']
            product_obj = self.env['product.product']
            variants = []
            if o['data']['name'] == order.pos_reference:
                picking_type = order.picking_type_id
                if not picking_type:
                    continue
                location_id = order.location_id.id
                address = order.partner_id.address_get(['delivery']) or {}
                if order.partner_id:
                    destination_id = order.partner_id.property_stock_customer.id
                else:
                    if (not picking_type) or (not picking_type.default_location_dest_id):
                        customerloc, supplierloc = warehouse_obj._get_partner_locations()
                        destination_id = customerloc.id
                    else:
                        destination_id = picking_type.default_location_dest_id.id
                if o['data'] and o['data'].get('lines', False):
                    for line in o['data']['lines']:
                        if line[2] and line[2].get('variants', False):
                            for var in line[2]['variants']:
                                if var.get('product_id'):
                                    variants.append(var)
                            del line[2]['variants']
                if variants:
                    picking_vals = {
                        'name': order.name + '/Variant',
                        'origin': order.name,
                        'partner_id': address.get('delivery', False),
                        'date_done': order.date_order,
                        'picking_type_id': picking_type.id,
                        'company_id': order.company_id.id,
                        'move_type': 'direct',
                        'note': order.note or "",
                        'location_id': location_id,
                        'location_dest_id': destination_id,
                        'pos_order_id': order.id,
                    }
                    order_picking = picking_obj.create(picking_vals)
                    for variant in variants:
                        product = product_obj.browse(variant.get('product_id')[0])
                        move = move_object.create({
                            'name': order.name,
                            'product_uom': variant['uom_id'] and variant['uom_id'][0] if variant.get('uom_id',
                                                                                                     []) else product.uom_id.id,
                            'picking_id': order_picking.id,
                            'picking_type_id': picking_type.id,
                            'product_id': product.id,
                            'product_uom_qty': abs(variant['quantity']),
                            'state': 'draft',
                            'location_id': location_id,
                            'location_dest_id': destination_id,
                        })
                        moves |= move
                    order_picking.action_assign()
                    order_picking.force_assign()
                    wiz = self.env['stock.immediate.transfer'].create({'pick_ids': [(4, order_picking.id)]})
                    wiz.process()
        return True

    def create_stock_move_with_lot(self, stock_move=None, lot_name=None):
        """set lot serial combo items"""
        """Set Serial/Lot number in pack operations to mark the pack operation done."""
        version_info = odoo.release.version_info
        if version_info and version_info[0] in [11, 12]:
            stock_production_lot = self.env['stock.production.lot']
            lots = stock_production_lot.search([('name', '=', lot_name)])
            if lots:
                self.env['stock.move.line'].create({
                    'move_id': stock_move.id,
                    'product_id': stock_move.product_id.id,
                    'product_uom_id': stock_move.product_uom.id,
                    'qty_done': stock_move.product_uom_qty,
                    'location_id': stock_move.location_id.id,
                    'location_dest_id': stock_move.location_dest_id.id,
                    'lot_id': lots[0].id,
                })
        return True

    def _payment_fields(self, ui_paymentline):
        payment_fields = super(pos_order, self)._payment_fields(ui_paymentline)
        if ui_paymentline.get('currency_id', None):
            payment_fields['currency_id'] = ui_paymentline.get('currency_id')
        if ui_paymentline.get('amount_currency', None):
            payment_fields['amount_currency'] = ui_paymentline.get('amount_currency')
        if ui_paymentline.get('voucher_id', None):
            payment_fields['voucher_id'] = ui_paymentline.get('voucher_id')
        return payment_fields

    # wallet rebuild partner for account statement line
    # default of odoo, if one partner have childs
    # and we're choose child
    # odoo will made account bank statement to parent, not child
    # what is that ??? i dont know reasons
    def _prepare_bank_statement_line_payment_values(self, data):
        version_info = odoo.release.version_info[0]
        datas = super(pos_order, self)._prepare_bank_statement_line_payment_values(data)
        order_id = self.id
        if datas.get('journal_id', False):
            journal = self.env['account.journal'].search([('id', '=', datas['journal_id'])])
            if journal and journal[0] and (journal.pos_method_type == 'wallet') and self.partner_id:
                datas.update({'partner_id': self.partner_id.id})
        if data.get('currency_id', None):
            datas['currency_id'] = data['currency_id']
        if data.get('amount_currency', None):
            datas['amount_currency'] = data['amount_currency']
        if data.get('payment_name', False) == 'return' and version_info != 12:
            datas.update({
                'currency_id': self.env.user.company_id.currency_id.id if self.env.user.company_id.currency_id else None,
                'amount_currency': data['amount']
            })
        journal_id = datas.get('journal_id')
        if journal_id and order_id and self.partner_id and self.partner_id.id != datas[
            'partner_id']:  # if customer use wallet, and customer have parent , we're reject default odoo map parent partner to payment line
            journal = self.env['account.journal'].browse(journal_id)
            if journal.pos_method_type == 'wallet':
                datas['partner_id'] = self.partner_id.id
        if data.get('voucher_id', None):
            datas['voucher_id'] = data['voucher_id']
        return datas


class pos_order_line(models.Model):
    _inherit = "pos.order.line"

    plus_point = fields.Float('Plus')
    redeem_point = fields.Float('Redeem')
    partner_id = fields.Many2one('res.partner', related='order_id.partner_id', string='Partner', readonly=1)
    promotion = fields.Boolean('Promotion', readonly=1)
    promotion_reason = fields.Char(string='Promotion reason', readonly=1)
    is_return = fields.Boolean('Return')
    combo_items = fields.Text('Combo', readonly=1)
    order_uid = fields.Text('order_uid', readonly=1)
    user_id = fields.Many2one('res.users', 'Sale person')
    session_info = fields.Text('session_info', readonly=1)
    uid = fields.Text('uid', readonly=1)
    variants = fields.Text('variants', readonly=1)
    tag_ids = fields.Many2many('pos.tag', 'pos_order_line_tag_rel', 'line_id', 'tag_id', string='Tags')
    note = fields.Text('Note')
    discount_reason = fields.Char('Discount reason')
    medical_insurance = fields.Boolean('Discount medical insurance')
    margin = fields.Float(
        'Margin', compute='_compute_multi_margin', store=True,
        multi='multi_margin', digits=dp.get_precision('Product Price'))
    purchase_price = fields.Float(
        'Cost Price', compute='_compute_multi_margin', store=True,
        multi='multi_margin', digits=dp.get_precision('Product Price'))
    reward_id = fields.Many2one('pos.loyalty.reward', 'Reward')
    packaging_id = fields.Many2one('product.packaging', string='Package/box')

    @api.multi
    @api.depends('product_id', 'qty', 'price_subtotal')
    def _compute_multi_margin(self):
        for line in self:
            if not line.product_id:
                line.purchase_price = 0
                line.margin = 0
            else:
                if line.uom_id and line.uom_id.id != line.product_id.uom_id.id:
                    purchase_price = line.product_id.standard_price
                    line.purchase_price = line.product_id.uom_id._compute_price(purchase_price, line.uom_id)
                    line.margin = line.price_subtotal - (
                            line.purchase_price * line.qty)
                else:
                    line.purchase_price = line.product_id.standard_price
                    line.margin = line.price_subtotal - (
                            line.product_id.standard_price * line.qty)

    @api.model
    def create(self, vals):
        voucher_val = {}
        if vals.get('voucher', {}):
            voucher_val = vals.get('voucher')
            del vals['voucher']
        if vals.get('mp_skip', {}):
            del vals['mp_skip']
        if 'voucher' in vals:
            del vals['voucher']
        order = self.env['pos.order'].browse(vals['order_id'])
        po_line = super(pos_order_line, self).create(vals)
        if po_line.product_id.is_voucher and voucher_val:
            today = datetime.today()
            if voucher_val.get('period_days', None):
                end_date = today + timedelta(days=voucher_val['period_days'])
            else:
                end_date = today + timedelta(days=order.config_id.expired_days_voucher)
            self.env['pos.voucher'].sudo().create({
                'number': voucher_val.get('number', None) if voucher_val.get('number', None) else '',
                'customer_id': order.partner_id and order.partner_id.id if order.partner_id else None,
                'start_date': fields.Datetime.now(),
                'end_date': end_date,
                'state': 'draft',
                'value': po_line.price_subtotal_incl,
                'apply_type': voucher_val.get('apply_type', None) if voucher_val.get('apply_type',
                                                                                     None) else 'fixed_amount',
                'method': voucher_val.get('method', None) if voucher_val.get('method', None) else 'general',
                'source': order.name,
                'pos_order_line_id': po_line.id
            })
        if po_line.product_id.is_credit:
            po_line.order_id.add_credit(po_line.price_subtotal_incl)
        self.env['pos.cache.database'].insert_data(self._inherit, po_line.id)
        return po_line

    @api.model
    def write(self, vals):
        res = super(pos_order_line, self).write(vals)
        for po_line in self:
            self.env['pos.cache.database'].insert_data(self._inherit, po_line.id)
        return res

    @api.multi
    def unlink(self):
        for record in self:
            self.env['pos.cache.database'].remove_record(self._inherit, record.id)
        return super(pos_order_line, self).unlink()
