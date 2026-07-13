import { registry } from "@web/core/registry";
import { useService, useBus } from "@web/core/utils/hooks";
import { user } from "@web/core/user";
import {
    Component,
    useState,
    onWillStart,
} from "@odoo/owl";

class CallSession extends Component {
    static template = "crm_call_center.CallSession";
    static props = {};

    setup() {
        this.svc       = useService("call_session");
        this.actionSvc = useService("action");
        this.tick      = useState({ v: 0 });
        useBus(this.svc.bus, "update", () => { this.tick.v++; });
        this.local     = useState({ filterDate: "" });

        onWillStart(async () => {
            if (!this.svc.state.uid) {
                await this.svc.init(user.userId);
            }
        });
    }

    get s()               { return this.svc.state; }
    get callQueue()       { return this.svc.state.callQueue || []; }
    get qualifiedLeads()  { return this.svc.state.qualifiedLeads || []; }

    fmt(sec)              { return this.svc.fmt(sec); }
    getStageLabel(lead)   { return this.svc.getStageLabel(lead); }
    getStageClass(statut) { return this.svc.getStageClass(statut); }
}

class MiniPlayer extends Component {
    static template = "crm_call_center.MiniPlayer";
    static props = {};

    setup() {
        this.svc       = useService("call_session");
        this.actionSvc = useService("action");
        this.tick      = useState({ v: 0 });
        useBus(this.svc.bus, "update", () => { this.tick.v++; });
    }

    get s()   { return this.svc.state; }
    fmt(sec)  { return this.svc.fmt(sec); }

    async goToSession() {
        await this.actionSvc.doAction({
            type:   "ir.actions.client",
            tag:    "crm_call_center.call_session",
            target: "current",
        });
    }
}

registry.category("actions").add("crm_call_center.call_session", CallSession);
registry.category("main_components").add("CallSessionMiniPlayer", {
    Component: MiniPlayer,
    props: {},
});
