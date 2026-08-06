import { FLAGS } from "./config.js";

class Director050 {
  constructor() {
    this.currentFlag = FLAGS.DATA_IDLE;
    this.agente001Flag = FLAGS.DATA_IDLE;
    this.interventorBlocked = false;
    this.forcedApproval = false;
    this.projectTitle = "Sin Proyecto";
    window.director050 = this;
  }

  updateProjectTitle(title) {
    this.projectTitle = title || "Sin Proyecto";
    this.renderUIState();
  }

  onAgente001Status(flag) {
    this.agente001Flag = flag;
    this.renderUIState();
  }

  updateFlag(newFlag) {
    this.currentFlag = newFlag;
    this.renderUIState();
  }

renderUIState() {
    const titleEl = document.getElementById("project-title");
    if (titleEl) {
      titleEl.innerText = this.projectTitle;
    }

    const btn = document.getElementById("btn-generar-ficha");
    if (!btn) return;

    if (this.currentFlag === FLAGS.OCR_PROCESSING || 
        this.agente001Flag === FLAGS.OCR_PROCESSING) {
      btn.disabled = true;
      btn.innerText = "Investigación en curso... (001)";
      btn.classList.add("loading-spinner");
    } else if (this.interventorBlocked) {
      btn.disabled = true;
      btn.innerText = "Bloqueado por Interventor (057)";
      btn.classList.add("blocked-state");
    } else {
      btn.disabled = false;
      btn.innerText = "Generar Ficha Técnica";
      btn.classList.remove("loading-spinner", "blocked-state");
    }
  }

  isBlockedByInterventor() {
    return this.interventorBlocked && !this.forcedApproval;
  }

  forceApproval() {
    this.forcedApproval = true;
    this.interventorBlocked = false;
    this.renderUIState();
    console.warn("[FORZAR_APROBACIÓN] ejecutado. Interventor ignorado.");
  }

  async triggerFichaGen() {
    if (this.agente001Flag === FLAGS.OCR_PROCESSING) {
      console.warn("Bloqueado: Agente 001 sigue trabajando.");
      return;
    }

    if (this.isBlockedByInterventor()) {
      console.warn("Bloqueado: Interventor (057) detecto inconsistencias.");
      return;
    }

    this.updateFlag(FLAGS.OCR_PROCESSING);
    
    try {
      await this.executeAgente051();
      await this.executeAgentesParalelos();
      this.updateFlag(FLAGS.OCR_READY);
    } catch (error) {
      this.updateFlag(FLAGS.OCR_ERROR);
      console.error("Error en flujo de Ficha Técnica:", error);
    }
  }

  async executeAgente051() {
    if (window.Agente051 && window.Agente051.generateFicha) {
      await window.Agente051.generateFicha();
    }
  }

  async executeAgentesParalelos() {
    const promises = [];
    
    if (window.Agente052) {
      promises.push(window.Agente052.render());
    }
    if (window.Agente053) {
      promises.push(window.Agente053.export());
    }

    await Promise.all(promises);
    console.log("Agentes 052 y 053 completados en paralelo.");
  }
}

window.Director050 = Director050;
export default Director050;