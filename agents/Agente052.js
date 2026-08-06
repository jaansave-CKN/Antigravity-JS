class Agente052 {
  constructor() {
    this.components = [];
  }

  async render() {
    console.log("Agente 052: Renderizando componentes visuales...");
    
    const ficha = window.Agente051?.get();
    if (!ficha) {
      throw new Error("No hay Ficha Técnica disponible");
    }

    this.components = this.translateToComponents(ficha);
    
    console.log("Agente 052: Componentes renderizados", this.components);
    return this.components;
  }

  translateToComponents(ficha) {
    const components = [];
    
    if (ficha.contenido) {
      components.push({
        type: "content-card",
        data: ficha.contenido
      });
    }

    if (ficha.fuente) {
      components.push({
        type: "source-badge",
        data: ficha.fuente
      });
    }

    components.push({
      type: "timestamp-display",
      data: new Date(ficha.timestamp)
    });

    return components;
  }

  getComponents() {
    return this.components;
  }

  recoverFromSnapshot(index) {
    const snapshots = window.Agente001?.snapshots || [];
    if (snapshots[index]) {
      return this.translateToComponents(snapshots[index].data);
    }
    return [];
  }
}

window.Agente052 = new Agente052();
export default Agente052;