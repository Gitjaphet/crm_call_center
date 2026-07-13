import { registry } from "@web/core/registry";
import { EventBus } from "@odoo/owl";

const callSessionService = {
    dependencies: ["orm", "notification"],

    start(env, { orm, notification }) {
        const bus = new EventBus();

        const state = {
            active: false, phase: "idle", paused: false,
            leads: [], qualifiedLeads: [], respondeurLeads: [], callQueue: [],
            currentIndex: 0, totalLeads: 0, callsDone: 0,
            currentLead: null, nextLead: null,
            callTimer: 0, pauseTimer: 0, convTimer: 0,
            callStartTime: null,
            hangup: false,
            noPhonePopup: false,
            qualification: null, notes: "", rappelDate: "", rappelHeure: "",
            qualifStages: [], lostReasons: [], allStages: {},
            lastResult: "", lastLeadName: "", lastRappelDate: "",
            uid: null, userTeamIds: [], filterMode: "team",
            _relancesBasculees: new Set(),
        };

        let _ci = null, _pi = null, _convI = null;
        const emit = () => bus.trigger("update");

        function clearTimers() {
            if (_ci) { clearInterval(_ci); _ci = null; }
            if (_pi) { clearInterval(_pi); _pi = null; }
            if (_convI) { clearInterval(_convI); _convI = null; }
        }

        function norm(name) {
            return (name || "").toLowerCase().normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_")
                .replace(/^_|_$/g, "");
        }

        function stageToStatut(n) {
            const k = norm(n);
            if (k.includes("rdv")) return "rdv";
            if (k.includes("rappel_programme") || k.includes("rappel_program")) return "rappel_programme";
            if (k.includes("rappel")) return "rappel";
            if (k.includes("repondeur") || k.includes("respondeur")) return "repondeur";
            return "en_cours";
        }

        function split(leads) {
            state.qualifiedLeads = leads.filter(l =>
                ["rdv", "rappel", "rappel_programme"].includes(l.statut_appel)
            );

            const actifs = leads.filter(l =>
                !["rdv", "rappel", "rappel_programme", "termine"].includes(l.statut_appel)
            );

            const nouveaux = actifs.filter(l =>
                !l.statut_appel || ["nouveau", "en_cours"].includes(l.statut_appel)
            );

            const repondeurs = actifs.filter(l => l.statut_appel === "repondeur");

            // CORRECTION : Plus de vérification de date buggée. 
            // Si c'est impair (1, 3, 5), ça attend la 2ème tentative du cycle.
            const eligiblesRelance = repondeurs.filter(l => {
                const nb = l.nb_tentatives || 0;
                return nb < 6 && (nb % 2 !== 0);
            });

            const relancesEnAttente = repondeurs.filter(l => !eligiblesRelance.includes(l));

            const dejaEnFile = eligiblesRelance.filter(l => state._relancesBasculees.has(l.id));
            const pasEncoreBasculees = eligiblesRelance.filter(l => !state._relancesBasculees.has(l.id));

            const fileActuelle = [...nouveaux, ...dejaEnFile];

            // Bascule uniquement s'il reste 1 ou 0 nouveau lead dans la file active
            if (fileActuelle.length <= 1 && pasEncoreBasculees.length > 0) {
                pasEncoreBasculees.forEach(l => state._relancesBasculees.add(l.id));
                state.callQueue = [...nouveaux, ...eligiblesRelance]; 
                state.respondeurLeads = relancesEnAttente;
            } else {
                state.callQueue = [...nouveaux, ...dejaEnFile];
                state.respondeurLeads = [...pasEncoreBasculees, ...relancesEnAttente];
            }
        }

        function nowStr() {
            return new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
        }

        async function saveCallMeta(leadId, startTime, duration) {
            try {
                const nowUtc = new Date().toISOString().slice(0, 19).replace('T', ' ');
                const durInt = Math.round(duration) || 0;
                await orm.write("crm.lead", [leadId], {
                    date_dernier_appel: nowUtc,
                    duree_dernier_appel: durInt,
                    heure_debut_appel: startTime || "",
                });
            } catch (e) {
                console.error("Erreur saveCallMeta:", e);
            }
        }

        async function autoLostRepondeur(leadId) {
            try {
                let reasonId = state.lostReasons.find(r =>
                    norm(r.name).includes("repondeur") || norm(r.name).includes("respondeur")
                )?.id;

                if (!reasonId) {
                    reasonId = state.lostReasons.find(r =>
                        norm(r.name).includes("sans_reponse") || norm(r.name).includes("no_answer")
                    )?.id;
                }

                if (!reasonId) {
                    const ids = await orm.create("crm.lost.reason", [{ name: "Répondeur (6 tentatives)" }]);
                    reasonId = Array.isArray(ids) ? ids[0] : ids;
                    await svc.loadQualifData();
                }

                await orm.write("crm.lead", [leadId], {
                    lost_reason_id: reasonId,
                    active: false,
                    statut_appel: "termine",
                });

                notification.add("Lead marqué perdu : 6 tentatives sans réponse.", { type: "warning" });
            } catch (e) {
                console.error("Erreur autoLostRepondeur:", e);
            }
        }

        function startCall() {
            if (!state.currentLead?.phone) {
                state.phase = "nophone";
                state.noPhonePopup = true;
                emit();
                return;
            }
            state.phase = "calling";
            state.callTimer = 0;
            state.convTimer = 0;
            state.paused = false;
            state.hangup = false;
            state.callStartTime = nowStr();
            clearTimers();
            _ci = setInterval(() => {
                if (!state.paused) {
                    state.callTimer++;
                    emit();
                    if (state.callTimer >= 30) svc.onNoAnswer();
                }
            }, 1000);
        }

        function startConvTimer() {
            _convI = setInterval(() => {
                state.convTimer++;
                emit();
            }, 1000);
        }

        function startPause(result, rappelDate = "") {
            state.phase = "pause";
            state.pauseTimer = 0;
            state.paused = false;
            state.lastResult = result;
            state.lastLeadName = state.currentLead?.partner_name || state.currentLead?.name || "";
            state.lastRappelDate = rappelDate;
            clearTimers();
            _pi = setInterval(() => {
                if (!state.paused) {
                    state.pauseTimer++;
                    emit();
                    if (state.pauseTimer >= 40) svc.goToNextLead();
                }
            }, 1000);
        }

        const svc = {
            bus, state,

            fmt(s) {
                const m = Math.floor(s / 60), sec = s % 60;
                return `${m}:${sec.toString().padStart(2, "0")}`;
            },

            fmtDate(lead) {
                const d = lead.date_dernier_appel || lead.write_date || lead.create_date;
                if (!d) return "";
                try {
                    let isoStr = d;
                    if (typeof d === 'string' && d.includes(' ') && !d.includes('T')) {
                        isoStr = d.replace(' ', 'T') + 'Z';
                    }
                    const dt = new Date(isoStr);
                    return dt.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })
                        + " " + dt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
                } catch (e) { return ""; }
            },

            fmtDuration(lead) {
                if (lead.duree_dernier_appel === false || lead.duree_dernier_appel === undefined) return null;
                return {
                    start: lead.heure_debut_appel || "",
                    duration: svc.fmt(lead.duree_dernier_appel),
                };
            },

            async init(uid) {
                state.uid = uid;
                state._relancesBasculees = new Set();
                const teams = await orm.searchRead("crm.team", [["member_ids", "in", [uid]]], ["id"], {});
                state.userTeamIds = teams.map(t => t.id);
                await Promise.all([svc.loadLeads(), svc.loadQualifData()]);
                emit();
            },

            async loadQualifData() {
                const stages = await orm.searchRead("crm.stage",
                    [["is_won", "=", false], ["sequence", ">", 0]],
                    ["id", "name", "sequence"], { order: "sequence asc" });
                state.qualifStages = stages.map(s => ({ type: "stage", id: s.id, name: s.name, isLost: false }));
                const all = await orm.searchRead("crm.stage", [], ["id", "name"], {});
                const map = {};
                for (const s of all) {
                    map[s.id] = s.name;
                    map[norm(s.name)] = s.id;
                    map[s.name] = s.id;
                }
                state.allStages = map;
                const r = await orm.searchRead("crm.lost.reason", [], ["id", "name"], { order: "name asc" });
                state.lostReasons = r.map(x => ({ type: "lost", id: x.id, name: x.name, isLost: true }));
            },

            async loadLeads() {
                const domain = [["statut_appel", "not in", ["termine"]], ["active", "=", true]];
                if (state.userTeamIds.length > 0) {
                    if (state.filterMode === "me") {
                        domain.push(["user_id", "=", state.uid]);
                        domain.push(["team_id", "in", state.userTeamIds]);
                    } else {
                        domain.push(["team_id", "in", state.userTeamIds]);
                    }
                }
                const leads = await orm.searchRead("crm.lead", domain,
                    ["id", "name", "partner_name", "contact_name", "phone", "email_from",
                        "jour_relance", "heure_relance", "nb_tentatives", "statut_appel",
                        "priorite_appel", "stage_id", "user_id", "team_id",
                        "write_date", "create_date",
                        "date_dernier_appel", "duree_dernier_appel", "heure_debut_appel"],
                    { order: "priorite_appel asc, jour_relance asc, id asc" });
                state.leads = leads;
                state.totalLeads = leads.length;
                split(leads);
                emit();
            },

            async setFilterMode(mode) {
                if (state.active) return;
                state.filterMode = mode;
                await svc.loadLeads();
            },

            get canStart() {
                return state.filterMode === "me";
            },

            async startSession() {
                if (!svc.canStart) return;
                state._relancesBasculees = new Set();
                await svc.loadLeads();
                if (state.callQueue.length === 0) {
                    notification.add("Aucun lead assigné à traiter !", { type: "warning" });
                    return;
                }
                state.active = true;
                state.callsDone = 0;
                state.currentIndex = 0;
                state.currentLead = state.callQueue[0];
                state.nextLead = state.callQueue[1] || null;
                emit();
                startCall();
            },

            stopSession() {
                clearTimers();
                state.active = false;
                state.phase = "idle";
                state.paused = false;
                state._relancesBasculees = new Set();
                emit();
                svc.loadLeads();
            },

            togglePause() { state.paused = !state.paused; emit(); },
            skipPause() { clearTimers(); svc.goToNextLead(); },

            hangUp() {
                clearTimers();
                const duration = state.phase === "calling" ? state.callTimer : state.convTimer;
                state.hangup = true;
                if (state.phase === "calling") {
                    state.convTimer = state.callTimer;
                    state.phase = "qualify";
                    state.qualification = null;
                    state.notes = "";
                    state.rappelDate = "";
                    state.rappelHeure = "";
                }
                if (state.currentLead?.id) {
                    saveCallMeta(state.currentLead.id, state.callStartTime, duration);
                }
                emit();
            },

            async onAnswered() {
                clearTimers();
                if (state.currentLead?.id) {
                    await saveCallMeta(state.currentLead.id, state.callStartTime, 0);
                }
                await orm.call("crm.lead", "action_appel_repondu", [[state.currentLead.id]]);
                state.phase = "qualify";
                state.convTimer = 0;
                state.hangup = false;
                state.qualification = null;
                state.notes = "";
                state.rappelDate = "";
                state.rappelHeure = "";
                emit();
                startConvTimer();
            },

            async onNoAnswer() {
                clearTimers();
                if (state.currentLead?.id) {
                    await saveCallMeta(state.currentLead.id, state.callStartTime, state.callTimer);
                }

                const nbAvant = state.currentLead.nb_tentatives || 0;
                const nbApres = nbAvant + 1;

                await orm.call("crm.lead", "action_pas_de_reponse", [[state.currentLead.id]]);

                if (nbApres >= 6) {
                    state._relancesBasculees.delete(state.currentLead.id);
                    await autoLostRepondeur(state.currentLead.id);
                } else {
                    const rid = state.allStages[norm("Répondeur")] || state.allStages["Répondeur"];
                    if (rid) {
                        await orm.write("crm.lead", [state.currentLead.id], {
                            stage_id: rid,
                            statut_appel: "repondeur",
                        });
                    }
                    if (state._relancesBasculees.has(state.currentLead.id)) {
                        state._relancesBasculees.delete(state.currentLead.id);
                    }
                }

                state.callsDone++;
                await svc.loadLeads();
                startPause(nbApres >= 6
                    ? "Perdu – 6 tentatives sans réponse"
                    : `Répondeur (tentative ${nbApres}/6)`);
                emit();
            },

            async skipNoPhone(deleteIt) {
                const leadId = state.currentLead.id;
                state.noPhonePopup = false;
                if (deleteIt) {
                    await orm.unlink("crm.lead", [leadId]);
                } else {
                    let reasonId = state.lostReasons.find(r => norm(r.name).includes("numero"))?.id;
                    if (!reasonId) {
                        const ids = await orm.create("crm.lost.reason", [{ name: "Pas de numéro" }]);
                        reasonId = Array.isArray(ids) ? ids[0] : ids;
                        await svc.loadQualifData();
                    }
                    await orm.write("crm.lead", [leadId], {
                        lost_reason_id: reasonId,
                        active: false,
                        statut_appel: "termine",
                    });
                }
                state._relancesBasculees.delete(leadId);
                state.callsDone++;
                await svc.loadLeads();
                svc.goToNextLead();
            },

            setQualif(q) { state.qualification = q; emit(); },

            isSelected(q) {
                if (!state.qualification) return false;
                return state.qualification.type === q.type && state.qualification.id === q.id;
            },

            get isRappelProgramme() {
                return state.qualification
                    ? norm(state.qualification.name || "").includes("rappel_programm")
                    : false;
            },

            async saveAndNext() {
                const q = state.qualification;
                if (!q) return;
                clearTimers();
                const duration = state.convTimer || state.callTimer || 0;
                
                if (state.currentLead?.id) {
                    await saveCallMeta(state.currentLead.id, state.callStartTime, duration);
                }
                
                const nextStatut = q.isLost ? "termine" : stageToStatut(q.name);

                // CORRECTION MAJEURE: Si le commercial choisit manuellement "Répondeur" dans la modal
                if (nextStatut === "repondeur") {
                    const nbAvant = state.currentLead.nb_tentatives || 0;
                    const nbApres = nbAvant + 1;
                    
                    // On simule le bouton "Pas de réponse" pour forcer l'incrémentation en base !
                    await orm.call("crm.lead", "action_pas_de_reponse", [[state.currentLead.id]]);
                    
                    if (nbApres >= 6) {
                        state._relancesBasculees.delete(state.currentLead.id);
                        await autoLostRepondeur(state.currentLead.id);
                    } else {
                        await orm.write("crm.lead", [state.currentLead.id], {
                            stage_id: q.id, statut_appel: "repondeur"
                        });
                        state._relancesBasculees.delete(state.currentLead.id);
                    }

                    if (state.notes) {
                        await orm.call("crm.lead", "message_post", [[state.currentLead.id]], {
                            body: state.notes, message_type: "comment", subtype_xmlid: "mail.mt_note",
                        });
                    }

                    state.callsDone++;
                    await svc.loadLeads();
                    startPause(nbApres >= 6 ? "Perdu – 6 tentatives sans réponse" : `Répondeur (tentative ${nbApres}/6)`);
                    emit();
                    return;
                }

                // Logique normale (Rappel, RDV, etc.)
                const vals = {};
                if (q.isLost) {
                    vals.lost_reason_id = q.id;
                    vals.active = false;
                    vals.statut_appel = "termine";
                } else {
                    vals.stage_id = q.id;
                    vals.statut_appel = nextStatut;
                }
                if (state.notes) vals.description = state.notes;
                await orm.write("crm.lead", [state.currentLead.id], vals);
                
                if (state.notes) {
                    await orm.call("crm.lead", "message_post",
                        [[state.currentLead.id]], {
                        body: state.notes,
                        message_type: "comment",
                        subtype_xmlid: "mail.mt_note",
                    });
                }
                
                state._relancesBasculees.delete(state.currentLead.id);
                
                let rs = "";
                if (svc.isRappelProgramme && state.rappelDate) {
                    rs = `${state.rappelDate}${state.rappelHeure ? " " + state.rappelHeure : ""}`;
                    await orm.call("crm.lead", "activity_schedule", [[state.currentLead.id]], {
                        activity_type_id: 2,
                        date_deadline: state.rappelDate,
                        note: state.notes || "Rappel programmé",
                        summary: "Rappel programmé",
                        user_id: state.uid,
                    });
                    await orm.write("crm.lead", [state.currentLead.id], { user_id: state.uid });
                }
                
                state.callsDone++;
                await svc.loadLeads();
                startPause(q.name, rs);
                emit();
            },

            async goToNextLead() {
                clearTimers();

                const targetId = state.nextLead?.id;
                let ni = -1;

                if (targetId) {
                    ni = state.callQueue.findIndex(l => l.id === targetId);
                }

                if (ni === -1) {
                    if (state.callQueue.length > 0) {
                        ni = 0;
                    } else {
                        state.active = false;
                        state.phase = "idle";
                        emit();
                        notification.add("Session terminée !", { type: "success" });
                        return;
                    }
                }

                state.currentIndex = ni;
                state.currentLead = state.callQueue[ni];
                state.nextLead = state.callQueue[ni + 1] || null;
                emit();
                startCall();
            },

            getStageClass(s) {
                return {
                    rdv: "bg-success",
                    rappel: "bg-primary",
                    rappel_programme: "bg-warning text-dark",
                    repondeur: "bg-secondary",
                    en_cours: "bg-info text-dark",
                }[s] || "bg-secondary";
            },

            getStageLabel(l) {
                return l.stage_id ? l.stage_id[1] : l.statut_appel || "";
            },
        };

        return svc;
    },
};

registry.category("services").add("call_session", callSessionService);
