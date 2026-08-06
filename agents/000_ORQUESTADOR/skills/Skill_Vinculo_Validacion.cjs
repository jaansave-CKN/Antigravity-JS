/**
 * SKILL: VINCULO_VALIDACION
 * Procesa mapa de identación de Stitch
 * Crea Vínculos de Validación jerárquicos
 * Minero no puede validar si hijo contradice padre
 * Mantiene jerarquía: Nacional > Departamental > Municipal
 */

const VinculoValidacion = {
    nombre: "Vínculo de Validación",
    estado: "INACTIVO",
    
    // Mapa de identación recibido de Stitch
    mapaIdentacion: {},
    
    // Vínculos de validación
    vinculos: [],
    
    // Jerarquía geográfica
    jerarquiaGeografica: {
        nacional: null,
        departamental: {},
        municipal: {}
    },
    
    procesarMapaIdentacion: (mapaStitch) => {
        VinculoValidacion.mapaIdentacion = mapaStitch;
        
        console.log(`\n🗺️ MAPA DE IDENTACIÓN RECIBIDO`);
        
        // Extraer estructura jerárquica
        const estructura = VinculoValidacion.extraerEstructura(mapaStitch);
        
        // Crear vínculos de validación
        const vinculosCreados = VinculoValidacion.crearVinculos(estructura);
        
        console.log(`   Vínculos creados: ${vinculosCreados.length}`);
        
        return {
            mapaProcesado: true,
            vinculos: vinculosCreados,
            estructura: estructura
        };
    },
    
    extraerEstructura: (mapa) => {
        const estructura = [];
        
        if (Array.isArray(mapa)) {
            mapa.forEach(item => {
                estructura.push({
                    id: item.id || item.codigo,
                    nivel: item.nivel || item.level || 1,
                    titulo: item.titulo || item.title || item.nombre,
                    valor: item.valor || item.value,
                    geografia: item.geografia || item.region || null,
                    hijos: item.hijos || item.children || []
                });
            });
        }
        
        return estructura;
    },
    
    crearVinculos: (estructura) => {
        const vinculos = [];
        
        estructura.forEach(item => {
            // Si tiene hijos, crear vínculo padre-hijo
            if (item.hijos && item.hijos.length > 0) {
                item.hijos.forEach(hijo => {
                    const vinculo = {
                        id: `VINC-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                        tipo: "JERARQUICO",
                        padre: {
                            id: item.id,
                            titulo: item.titulo,
                            nivel: item.nivel,
                            valor: item.valor,
                            geografia: item.geografia
                        },
                        hijo: {
                            id: hijo.id || hijo.codigo,
                            titulo: hijo.titulo || hijo.title || hijo.nombre,
                            nivel: hijo.nivel || item.nivel + 1,
                            valor: hijo.valor || hijo.value,
                            geografia: hijo.geografia || hijo.region
                        },
                        reglaValidacion: "NO_CONTRADICCION",
                        estado: "ACTIVO",
                        timestamp: new Date().toISOString()
                    };
                    
                    vinculos.push(vinculo);
                });
            }
            
            // Crear vínculo geográfico (Nacional > Departamental > Municipal)
            if (item.geografia) {
                const vinculoGeo = VinculoValidacion.crearVinculoGeografico(item);
                if (vinculoGeo) vinculos.push(vinculoGeo);
            }
        });
        
        VinculoValidacion.vinculos = vinculos;
        return vinculos;
    },
    
    crearVinculoGeografico: (item) => {
        const geo = item.geografia.toLowerCase();
        
        // Determinar nivel geográfico
        let nivelGeo = "municipal";
        let padreGeo = null;
        
        if (geo.includes("nacional") || geo === "colombia") {
            nivelGeo = "nacional";
            VinculoValidacion.jerarquiaGeografica.nacional = item;
            padreGeo = null;
        } else if (geo.includes("departamento") || geo.includes("departamental")) {
            nivelGeo = "departamental";
            const depto = item.codigo || item.id;
            VinculoValidacion.jerarquiaGeografica.departamental[depto] = item;
            padreGeo = VinculoValidacion.jerarquiaGeografica.nacional;
        } else if (geo.includes("municipal") || geo.includes("ciudad")) {
            nivelGeo = "municipal";
            const depto = item.codigo_departamento || item.id.substring(0, 2);
            if (!VinculoValidacion.jerarquiaGeografica.municipal[depto]) {
                VinculoValidacion.jerarquiaGeografica.municipal[depto] = [];
            }
            VinculoValidacion.jerarquiaGeografica.municipal[depto].push(item);
            padreGeo = VinculoValidacion.jerarquiaGeografica.departamental[depto];
        }
        
        if (!padreGeo && nivelGeo !== "nacional") return null;
        
        return {
            id: `VINC-GEO-${Date.now()}`,
            tipo: "GEOGRAFICO",
            nivel: nivelGeo,
            item: item,
            padre: padreGeo,
            reglaValidacion: "JERARQUIA_OBLIGATORIA",
            estado: "ACTIVO",
            timestamp: new Date().toISOString()
        };
    },
    
    // Validar que hijo no contradiga padre
    validarAlerta: (alerta) => {
        const resultados = [];
        
        // Verificar cada vínculo activo
        VinculoValidacion.vinculos.forEach(vinculo => {
            if (vinculo.estado !== "ACTIVO") return;
            
            // Si la alerta coincide con el hijo, verificar que no contradiga padre
            if (vinculo.hijo && vinculo.hijo.id === alerta.codigoItem) {
                const validacion = VinculoValidacion.verificarNoContradiccion(
                    vinculo.padre,
                    vinculo.hijo,
                    alerta
                );
                resultados.push({
                    vinculoId: vinculo.id,
                    valida: validacion.valida,
                    razon: validacion.razon,
                    puedePasarMinero: validacion.valida
                });
            }
        });
        
        return {
            alertaId: alerta.id,
            validada: resultados.some(r => r.valida),
            resultados: resultados,
            puedePasarMinero: resultados.every(r => r.puedePasarMinero)
        };
    },
    
    verificarNoContradiccion: (padre, hijo, alerta) => {
        // Lógica de no contradicción
        // Por defecto, si el contenido de alerta incluye el valor del hijo, es válido
        // Solo hay contradicción si explícitamente contradice
        
        const valorPadre = (padre.valor || "").toLowerCase();
        const valorHijo = (hijo.valor || "").toLowerCase();
        const contenidoAlerta = (alerta.contenido || "").toLowerCase();
        
        // Verificar si alerta contiene términos del hijo (compatibilidad positiva)
        const esCompatible = contenidoAlerta.includes(valorHijo) || 
                            valorHijo.split(" ").some(p => p.length > 3 && contenidoAlerta.includes(p));
        
        // Solo es contradicción si explícitamente dice lo opuesto
        const contradiccionExplicita = contenidoAlerta.includes("no " + valorHijo) ||
                                      contenidoAlerta.includes("nunca " + valorHijo);
        
        return {
            valida: !contradiccionExplicita,
            razon: contradiccionExplicita 
                ? `Alerta contradice explícitamente: "${valorHijo}"`
                : esCompatible 
                    ? `Alerta compatible con jerarquía`
                    : "Alerta no contradictoria - permit"
        };
    },
    
    // Obtener estado de vínculos
    estadoVinculos: () => {
        return {
            total: VinculoValidacion.vinculos.length,
            activos: VinculoValidacion.vinculos.filter(v => v.estado === "ACTIVO").length,
            jerarquia: {
                nacional: VinculoValidacion.jerarquiaGeografica.nacional ? "✓" : "✗",
                departamentales: Object.keys(VinculoValidacion.jerarquiaGeografica.departamental).length,
                municipales: Object.keys(VinculoValidacion.jerarquiaGeografica.municipal).length
            }
        };
    }
};

module.exports = VinculoValidacion;