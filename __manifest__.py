{
    'name': 'CRM Call Center',
    'version': '19.0.1.0.0',
    'category': 'CRM',
    'summary': 'Gestion des appels et relances automatiques',
    'depends': ['crm', 'web'],
    'data': [
        'security/ir.model.access.csv',
        'views/crm_lead_views.xml',
        'views/call_session_action.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'crm_call_center/static/src/components/call_session_service.js',
            'crm_call_center/static/src/components/call_session.xml',
            'crm_call_center/static/src/components/call_session.js',
            'crm_call_center/static/src/css/call_session.css',
        ],
    },
    'installable': True,
    'application': False,
}
