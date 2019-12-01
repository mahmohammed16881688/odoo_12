# -*- coding: utf-8 -*-
from odoo import fields, api, models, api, _


class pos_loyalty_category(models.Model):
    _name = "pos.loyalty.category"
    _description = "Customer loyalty type"

    name = fields.Char('Name', required=1)
    code = fields.Char('Code', required=1)
    active = fields.Boolean('Active', default=1)
    from_point = fields.Float('Point from', required=1)
    to_point = fields.Float('Point to', required=1)


class pos_loyalty(models.Model):
    _name = "pos.loyalty"
    _description = "Loyalties program"

    name = fields.Char('Name', required=1)
    rule_ids = fields.One2many('pos.loyalty.rule', 'loyalty_id', 'Rules')
    reward_ids = fields.One2many('pos.loyalty.reward', 'loyalty_id', 'Rewards')
    state = fields.Selection([
        ('running', 'Running'),
        ('stop', 'Stop')
    ], string='State', default='running')
    product_loyalty_id = fields.Many2one('product.product', string='Rs',
                                         domain=[('available_in_pos', '=', True)], required=1)
    rounding = fields.Float(string='Points Rounding', default=1,
                            help="The loyalty point amounts are rounded to multiples of this value.")

    @api.model
    def default_get(self, default_fields):
        res = super(pos_loyalty, self).default_get(default_fields)
        products = self.env['product.product'].search([('default_code', '=', 'Rs')])
        if products:
            res.update({'product_loyalty_id': products[0].id})
        return res

    @api.multi
    def active_all_pos(self):
        configs = self.env['pos.config'].search([])
        for loyalty in self:
            configs.write({'loyalty_id': loyalty.id})
        return True


class pos_loyalty_rule(models.Model):
    _name = "pos.loyalty.rule"
    _rec_name = 'loyalty_id'
    _description = "Loyalties rule plus points"

    name = fields.Char('Name', required=1)
    active = fields.Boolean('Active', default=1)
    loyalty_id = fields.Many2one('pos.loyalty', 'Loyalty', required=1)
    coefficient = fields.Float('Coefficient (1 money = ? point)', required=1,
                               help='Example: if need 1 EUR will cover to 10 point set is 10',
                               default=1)
    type = fields.Selection([
        ('products', 'Products'),
        ('categories', 'Categories'),
        ('order_amount', 'Order amount')
    ], string='Type', required=1, default='products')
    product_ids = fields.Many2many('product.product', 'loyalty_rule_product_rel', 'rule_id', 'product_id',
                                   string='Products', domain=[('available_in_pos', '=', True)])
    category_ids = fields.Many2many('pos.category', 'loyalty_rule_pos_categ_rel', 'rule_id', 'categ_id',
                                    string='Categories')
    min_amount = fields.Float('Min amount', required=1, help='This condition min amount of order can apply rule')
    coefficient_note = fields.Text(compute='_get_coefficient_note', string='Coefficient note')
    state = fields.Selection([
        ('running', 'Running'),
        ('stop', 'Stop')
    ], string='State', default='running')

    @api.multi
    def _get_coefficient_note(self):
        for rule in self:
            rule.coefficient_note = '1 %s will cover to %s point ' % (self.env.user.company_id.currency_id.name, rule.coefficient)

class pos_loyalty_reward(models.Model):
    _name = "pos.loyalty.reward"
    _description = "Loyalties rule redeem points"

    name = fields.Char('Name', required=1)
    active = fields.Boolean('Active', default=1)
    loyalty_id = fields.Many2one('pos.loyalty', 'Loyalty', required=1)
    redeem_point = fields.Float('Redeem point', help='This is total point get from customer when cashier Reward')
    type = fields.Selection([
        ('discount_products', 'Discount products'),
        ('discount_categories', "Discount categories"),
        ('gift', 'Free gift'),
        ('resale', "Sale off got point"),
        ('use_point_payment', "Use point for paid"),
    ], string='Type of reward', required=1, help="""
        Discount Products: Will discount list products filter by products\n
        Discount categories: Will discount products filter by categories \n
        Gift: Will free gift products to customers \n
        Sale off got point : sale off list products and get points from customers \n
        Use point payment : covert point to discount price \n
    """)
    coefficient = fields.Float('Coefficient (1 point = ? money)', required=1,
                               help='Example: Your shop need cover 100 point to 1 EUR, input 100', default=1)
    discount = fields.Float('Discount %', required=1, help='Discount %')
    discount_product_ids = fields.Many2many('product.product', 'reward_product_rel', 'reward_id', 'product_id',
                                            string='Products', domain=[('available_in_pos', '=', True)])
    discount_category_ids = fields.Many2many('pos.category', 'reward_pos_categ_rel', 'reward_id', 'categ_id',
                                             string='Categories')
    min_amount = fields.Float('Min amount', required=1, help='This condition min amount of order can apply reward')
    gift_product_ids = fields.Many2many('product.product', 'reward_gift_product_product_rel', 'reward_id',
                                        'gift_product_id',
                                        string='Gift Products', domain=[('available_in_pos', '=', True)])
    resale_product_ids = fields.Many2many('product.product', 'reward_resale_product_product_rel', 'reward_id',
                                          'resale_product_id',
                                          string='Resale Products', domain=[('available_in_pos', '=', True)])
    gift_quantity = fields.Float('Gift Quantity', default=1)
    price_resale = fields.Float('Price of resale')
    coefficient_note = fields.Text(compute='_get_coefficient_note', string='Coefficient note')
    state = fields.Selection([
        ('running', 'Running'),
        ('stop', 'Stop')
    ], string='State', default='running')
    line_ids = fields.One2many('pos.order.line', 'reward_id', 'POS order lines')

    @api.multi
    def _get_coefficient_note(self):
        for rule in self:
            rule.coefficient_note = '1 point will cover to %s %s ' % (
                rule.coefficient,self.env.user.company_id.currency_id.name)
