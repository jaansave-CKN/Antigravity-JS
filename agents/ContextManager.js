const ContextManager = {
  activeProject: {
    id: "PROY_01",
    name: "Donaciones_Cantagallo"
  },

  init() {
    this.updateUIHeader();
    console.log("✅ ContextManager inicializado");
  },

  updateUIHeader() {
    const header = document.getElementById("project-display-name");
    if (header) {
      header.innerText = `📂 ${this.activeProject.id} | ${this.activeProject.name}`;
      header.style.color = "#00ff00";
      header.style.fontWeight = "bold";
    }
    
    document.title = `[${this.activeProject.id}] Antigravity OS`;
  },

  setActiveProject(id, name) {
    this.activeProject.id = id;
    this.activeProject.name = name;
    this.updateUIHeader();
    console.log(`🔄 Proyecto cambiado: ${id} - ${name}`);
  }
};

window.ContextManager = ContextManager;
export default ContextManager;