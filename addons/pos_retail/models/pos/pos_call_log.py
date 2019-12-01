# -*- coding: utf-8 -*-
from odoo import api, models, fields, registry
import odoo
from odoo.tools import DEFAULT_SERVER_DATETIME_FORMAT
import json
import logging

_logger = logging.getLogger(__name__)


class pos_call_log(models.Model):
    _rec_name = "call_model"
    _name = "pos.call.log"
    _description = "Log datas of pos sessions"

    min_id = fields.Integer('Min Id', required=1, index=True, readonly=1)
    max_id = fields.Integer('Max Id', required=1, index=True, readonly=1)
    call_domain = fields.Char('Domain', required=1, index=True, readonly=1)
    call_results = fields.Char('Results', readonly=1)
    call_model = fields.Char('Model', required=1, index=True, readonly=1)
    call_fields = fields.Char('Fields', index=True, readonly=1)
    active = fields.Boolean('Active', default=True)
    write_date = fields.Datetime('Write date', readonly=1)

    @api.multi
    def compare_database_write_date(self, model, pos_write_date):
        last_logs = self.search([('call_model', '=', model), ('write_date', '<', pos_write_date)])
        if last_logs:
            _logger.info('POS write date is %s' % pos_write_date)
            _logger.info('Model %s write date is %s' % (model, last_logs[0].write_date))
            return True
        else:
            return False

    def covert_datetime(self, model, datas):
        all_fields = self.env[model].fields_get()
        version_info = odoo.release.version_info[0]
        if version_info == 12:
            if all_fields:
                for data in datas:
                    for field, value in data.items():
                        if field == 'model':
                            continue
                        if all_fields[field] and all_fields[field]['type'] in ['date', 'datetime'] and value:
                            data[field] = value.strftime(DEFAULT_SERVER_DATETIME_FORMAT)
        return datas

    @api.multi
    def refresh_call_logs(self):
        _logger.info('========================= BEGIN refresh_call_logs ========================================')
        cache_database_object = self.env['pos.cache.database']
        logs = self.search([])
        for log in logs:
            call_fields = cache_database_object.get_fields_by_model(log.call_model)
            call_domain = cache_database_object.get_domain_by_model(log.call_model)
            call_domain.append(['id', '>=', log.min_id])
            call_domain.append(['id', '<=', log.max_id])
            _logger.info('Refresh log of model: %s' % log.call_model)
            _logger.info(call_domain)
            _logger.info('===============================')
            results = self.env[log.call_model].sudo().search_read(
                call_domain,
                call_fields)
            version_info = odoo.release.version_info[0]
            if version_info == 12:
                all_fields = self.env[log.call_model].fields_get()
                if all_fields:
                    for result in results:
                        for field, value in result.items():
                            if field == 'model':
                                continue
                            if all_fields[field] and all_fields[field]['type'] in ['date', 'datetime'] and value:
                                result[field] = value.strftime(DEFAULT_SERVER_DATETIME_FORMAT)
            log.write({
                'call_results': json.dumps(results),
                'call_fields': json.dumps(call_fields),
                'call_domain': json.dumps(call_domain),
            })
        self.env['pos.cache.database'].search([]).unlink()
        _logger.info('========================= END refresh_call_logs ========================================')
        return True
