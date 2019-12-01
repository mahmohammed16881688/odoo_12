# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
import odoo
import logging

_logger = logging.getLogger(__name__)


class pos_order_line_lot(models.Model):
    _name = "pos.order.line.lot"
    _description = "Table temp of lot and order line"

    pos_order_line_id = fields.Many2one('pos.order.line')
    order_id = fields.Many2one('pos.order', related="pos_order_line_id.order_id", readonly=False)
    lot_name = fields.Char('Lot Name')
    product_id = fields.Many2one('product.product', related='pos_order_line_id.product_id', readonly=False)
    quantity = fields.Float('Quantity')


class pos_order_line(models.Model):
    _inherit = "pos.order.line"

    @api.model
    def create(self, vals):
        po_line = super(pos_order_line, self).create(vals)
        if vals.get('lot_ids', None):
            for lot in vals.get('lot_ids', None):
                self.env['pos.order.line.lot'].create({
                    'pos_order_line_id': po_line.id,
                    'order_id': po_line.order_id.id,
                    'lot_name': lot['name'],
                    'quantity': lot['quantity']
                })
        return po_line


class pos_order(models.Model):
    _inherit = "pos.order"

    def _force_picking_done(self, picking):
        _logger.info('BEGIN _force_picking_done()')
        version_info = odoo.release.version_info
        if version_info[0] != 10:
            self.ensure_one()
            picking.action_assign()
            multi_lots = self.set_pos_order_line_lot(picking)
            wrong_lots = self.set_pack_operation_lot(picking)
            if not wrong_lots:
                picking.action_done()
            if not wrong_lots and multi_lots:
                picking.action_done()
        else:
            super(pos_order, self)._force_picking_done(picking)

    def set_pos_order_line_lot(self, picking=None):
        _logger.info('BEGIN set_pos_order_line_lot()')
        pos_order_line_lot_obj = self.env['pos.order.line.lot']
        stock_production_lot_obj = self.env['stock.production.lot']
        stock_move_line_obj = self.env['stock.move.line']
        multi_lots = False
        for order in self:
            for move in (picking or self.picking_id).move_lines:
                stock_move_line_obj.search([('move_id', '=', move.id)]).unlink()
                pack_lots = []
                pos_pack_lots = pos_order_line_lot_obj.search(
                    [('order_id', '=', order.id), ('product_id', '=', move.product_id.id)])
                for lot in pos_pack_lots:
                    stock_production_lot = stock_production_lot_obj.search(
                        [('name', '=', lot.lot_name), ('product_id', '=', move.product_id.id)])
                    if stock_production_lot:
                        pack_lots.append({
                            'lot_id': stock_production_lot[0].id,
                            'qty': lot.quantity,
                            'lot': stock_production_lot[0]
                        })

                for pack_lot in pack_lots:
                    lot_id, qty, lot = pack_lot['lot_id'], pack_lot['qty'], pack_lot['lot']
                    self.env['stock.move.line'].search(
                        [('move_id', '=', move.id), ('product_id', '=', move.product_id.id),
                         ('lot_id', '=', lot_id)]).write({'qty_done': 0})
                    vals = {
                        'move_id': move.id,
                        'product_id': move.product_id.id,
                        'product_uom_id': move.product_uom.id if move.product_uom else move.product_id.uom_id.id,
                        'qty_done': qty,
                        'location_id': move.location_id.id,
                        'location_dest_id': move.location_dest_id.id,
                        'lot_id': lot_id,
                    }
                    self.env['stock.move.line'].create(vals)
                    multi_lots = True
        return multi_lots
