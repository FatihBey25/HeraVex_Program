// Flow Center starter templates (v0.9.8).
//
// One-click seeds for the indie-dev workflows the module is built for:
// game loop, dialogue tree, sprint/task graph, enemy state machine.
// Each builder returns nodes + edges positioned relative to a drop
// point, with fresh ids so multiple inserts never collide.

import { makeNode, flowId, type FlowNode, type FlowEdge } from "./flow";

export type FlowTemplateId = "gameloop" | "dialogue" | "sprint" | "statemachine";

export interface FlowTemplateMeta {
  id: FlowTemplateId;
  label: [string, string]; // [en, tr]
  hint: [string, string];
}

export const FLOW_TEMPLATES: FlowTemplateMeta[] = [
  { id: "gameloop",     label: ["Game loop", "Oyun döngüsü"],        hint: ["Core action → reward loop", "Eylem → ödül döngüsü"] },
  { id: "dialogue",     label: ["Dialogue tree", "Diyalog ağacı"],   hint: ["Branching conversation", "Dallanan diyalog"] },
  { id: "sprint",       label: ["Sprint board", "Sprint akışı"],     hint: ["Task dependency flow", "Görev bağımlılığı"] },
  { id: "statemachine", label: ["AI state machine", "AI state machine"], hint: ["Enemy behaviour states", "Düşman davranış durumları"] },
];

type Built = { nodes: FlowNode[]; edges: FlowEdge[] };
type Tr = (en: string, t: string) => string;

function edge(source: string, target: string, sourceHandle?: string, label?: string): FlowEdge {
  return { id: flowId("e"), source, target, sourceHandle: sourceHandle ?? null, targetHandle: null, type: "smoothstep", label };
}

export function buildTemplate(id: FlowTemplateId, bx: number, by: number, tr: Tr): Built {
  switch (id) {
    case "gameloop": {
      const a = makeNode("card", bx,       by,       tr("Start", "Başla"));
      const b = makeNode("card", bx + 260, by,       tr("Player action", "Oyuncu eylemi"));
      const c = makeNode("card", bx + 520, by,       tr("Reward", "Ödül"));
      const d = makeNode("card", bx + 520, by + 170, tr("Progression", "İlerleme"));
      const e = makeNode("decision", bx + 260, by + 170, tr("Continue?", "Devam?"));
      return {
        nodes: [a, b, c, d, e],
        edges: [
          edge(a.id, b.id),
          edge(b.id, c.id),
          edge(c.id, d.id),
          edge(d.id, e.id),
          edge(e.id, b.id, "yes", tr("yes", "evet")),
          edge(e.id, a.id, "no", tr("no", "hayır")),
        ],
      };
    }
    case "dialogue": {
      const npc = makeNode("card",     bx,       by,       tr("NPC line", "NPC repliği"));
      const dec = makeNode("decision", bx + 260, by,       tr("Player choice?", "Oyuncu seçimi?"));
      const yes = makeNode("card",     bx + 520, by - 90,  tr("Friendly reply", "Dostça cevap"));
      const no  = makeNode("card",     bx + 520, by + 90,  tr("Hostile reply", "Düşmanca cevap"));
      const end = makeNode("card",     bx + 780, by,       tr("Continue scene", "Sahneye devam"));
      return {
        nodes: [npc, dec, yes, no, end],
        edges: [
          edge(npc.id, dec.id),
          edge(dec.id, yes.id, "yes", tr("kind", "nazik")),
          edge(dec.id, no.id, "no", tr("rude", "kaba")),
          edge(yes.id, end.id),
          edge(no.id, end.id),
        ],
      };
    }
    case "sprint": {
      const back = makeNode("card", bx,       by,       tr("Backlog", "Yapılacak"));
      const t1   = makeNode("card", bx + 260, by - 90,  tr("Build feature", "Özellik geliştir"));
      const t2   = makeNode("card", bx + 260, by + 90,  tr("Make assets", "Asset üret"));
      const rev  = makeNode("card", bx + 520, by,       tr("Review / test", "İncele / test"));
      const ship = makeNode("date", bx + 780, by,       tr("Release", "Sürüm"));
      return {
        nodes: [back, t1, t2, rev, ship],
        edges: [
          edge(back.id, t1.id),
          edge(back.id, t2.id),
          edge(t1.id, rev.id),
          edge(t2.id, rev.id),
          edge(rev.id, ship.id),
        ],
      };
    }
    case "statemachine": {
      const idle   = makeNode("card", bx,       by,       tr("Idle", "Boşta"));
      const patrol = makeNode("card", bx + 260, by,       tr("Patrol", "Devriye"));
      const chase  = makeNode("card", bx + 520, by,       tr("Chase", "Kovala"));
      const attack = makeNode("card", bx + 520, by + 170, tr("Attack", "Saldır"));
      const flee   = makeNode("card", bx + 260, by + 170, tr("Flee", "Kaç"));
      return {
        nodes: [idle, patrol, chase, attack, flee],
        edges: [
          edge(idle.id, patrol.id, undefined, tr("timer", "süre")),
          edge(patrol.id, chase.id, undefined, tr("sees player", "oyuncuyu görür")),
          edge(chase.id, attack.id, undefined, tr("in range", "menzilde")),
          edge(attack.id, flee.id, undefined, tr("low HP", "düşük HP")),
          edge(flee.id, idle.id, undefined, tr("safe", "güvenli")),
          edge(chase.id, patrol.id, undefined, tr("lost player", "oyuncuyu kaybetti")),
        ],
      };
    }
  }
}
