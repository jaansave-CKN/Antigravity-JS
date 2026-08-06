import { FLAGS, AGENT_CONFIGS } from "./config.js";
import Agente001 from "./Agente001.js";
import Agente050 from "./Agente050.js";
import Agente051 from "./Agente051.js";
import Agente052 from "./Agente052.js";
import ContextManager from "./ContextManager.js";

console.log("Sistema de Agentes iniciado");
console.log("Configuraciones cargadas:", Object.keys(AGENT_CONFIGS));

window.AGENTS = {
  FLAGS,
  AGENT_CONFIGS,
  Agente001,
  Agente050,
  Agente051,
  Agente052,
  ContextManager
};

if (window.ContextManager) {
  window.ContextManager.init();
}

export { FLAGS, AGENT_CONFIGS, Agente001, Agente050, Agente051, Agente052, ContextManager };
