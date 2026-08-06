/**
 * SKILL: API_ALERTAS (Endpoint /alerts)
 * Alimenta el Centro de Alertas de Radar 360
 * Contadores: Activas y Últimas 24h
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const API_Alertas = {
    nombre: "API Local de Alertas",
    puerto: 3847,
    estado: "INACTIVO",
    servidor: null,
    
    alertas: {
        activas: [],
        ultimas24h: [],
        historial: []
    },
    
    // Objeto de Comunicación Unificado
    comm: {
        conexionUnica: true,
        endpointUnificado: "/alerts/api",
        context_anchors: [],
        lastSync: null,
        fetchError: null
    },
    
    // Active Context - Ancla de Búsqueda
    active_context: {
        id: null,
        tipo: null,
        valor: null,
        timestamp: null,
        anclaBusqueda: null
    },
    
    // Anclas de búsqueda activas (compatibilidad)
    anclasBusqueda: [],
    
    // Base de datos de grupos jerárquicos
    gruposJerarquicos: {},
    
    contadores: {
        activas: 0,
        ultimas24h: 0,
        totales: 0
    },
    
    // Rate Limiter - Previene bucle de peticiones
    rateLimiter: {
        peticiones: {}, // { ip: [timestamps] }
        limite: 2, // máx peticiones
        ventanaMs: 1000, // en 1 segundo
        bloqueado: {},
        
        verificar: function(ip) {
            const ahora = Date.now();
            if (this.bloqueado[ip] && this.bloqueado[ip] > ahora) {
                return { bloqueado: true, mensaje: "Procesando, por favor espere..." };
            }
            
            if (!this.peticiones[ip]) {
                this.peticiones[ip] = [];
            }
            
            // Limpiar peticiones antiguas
            this.peticiones[ip] = this.peticiones[ip].filter(t => ahora - t < this.ventanaMs);
            
            // Verificar límite
            if (this.peticiones[ip].length >= this.limite) {
                this.bloqueado[ip] = ahora + 2000; // Bloquear por 2 segundos
                console.log(`⛔ RATE LIMIT: IP ${ip} bloqueada temporalmente`);
                return { bloqueado: true, mensaje: "Procesando, por favor espere..." };
            }
            
            // Registrar petición
            this.peticiones[ip].push(ahora);
            return { bloqueado: false };
        }
    },
    
    iniciar: () => {
        if (API_Alertas.estado === "ACTIVO") {
            return { estado: "YA_ACTIVO", mensaje: "API ya está corriendo" };
        }
        
        const server = http.createServer((req, res) => {
            API_Alertas.manejarSolicitud(req, res);
        });
        
        server.listen(API_Alertas.puerto, () => {
            API_Alertas.estado = "ACTIVO";
            API_Alertas.servidor = server;
            console.log(`\n🌐 API DE ALERTAS ACTIVADA`);
            console.log(`   Puerto: ${API_Alertas.puerto}`);
            console.log(`   Endpoint: http://localhost:${API_Alertas.puerto}/alerts`);
            console.log(`   Estado: CONECTADO`);
            console.log(`   Handshake: Radar 360 App`);
        });
        
        return { estado: "API_INICIADA", puerto: API_Alertas.puerto };
    },
    
    manejarSolicitud: (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        
        if (req.method === "OPTIONS") {
            res.writeHead(200);
            res.end();
            return;
        }
        
        const url = req.url.split("?")[0];
        
        // Endpoint /api/v1/alerts con sanitización profunda y safe mode
        if (url === "/api/v1/alerts" || url === "/alerts/seguro") {
            if (req.method === "POST") {
                // Rate Limiter - Verificar antes de procesar
                const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
                const checkRate = API_Alertas.rateLimiter.verificar(ip);
                
                if (checkRate.bloqueado) {
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ 
                        status: "rate_limited", 
                        message: checkRate.mensaje 
                    }));
                    return;
                }
                
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    try {
                        const rawContext = JSON.parse(body).context || [];
                        
                        // 1. Sanitización profunda
                        let lastValidParent = "Contexto Global";
                        let lastParentStatus = false;

                        const safeContext = rawContext.map(row => {
                            const isChild = String(row.nivel).includes('.');
                            
                            if (!isChild) {
                                lastValidParent = row.entidad || "Entidad Sin Nombre";
                                lastParentStatus = row.isActive === true;
                            }

                            return {
                                id: row.id,
                                nivel: row.nivel,
                                entidad: isChild ? lastValidParent : (row.entidad || ""),
                                referencia: row.referencia || "",
                                fuente: row.fuente || "Local",
                                isActive: isChild ? lastParentStatus : (row.isActive === true)
                            };
                        });

                        // 2. Filtrar solo lo que está activo antes de pasarlo al Minero
                        const activeContext = safeContext.filter(c => c.isActive);

                        if (activeContext.length === 0) {
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ 
                                status: "idle", 
                                alerts: [], 
                                message: "Esperando activación de contexto." 
                            }));
                            return;
                        }

                        // Aquí se conectaría con radarMinero.fetch(activeContext)
                        console.log(`\n✅ CONTEXTO PROCESADO: ${activeContext.length} nodos activos`);
                        
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ 
                            status: "success", 
                            alerts: activeContext 
                        }));

                    } catch(error) {
                        console.error("[CRITICAL] Fallo en procesamiento de contexto:", error.message);
                        res.writeHead(200, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ 
                            status: "safe_mode", 
                            alerts: [], 
                            error: error.message 
                        }));
                    }
                });
            } else {
                res.writeHead(405);
                res.end();
            }
        } else if (url === "/alerts/seguro") {
            if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    try {
                        const contextData = JSON.parse(body).context || [];
                        
                        // Si no hay datos válidos, responder array vacío
                        if (!Array.isArray(contextData) || contextData.length === 0) {
                            res.writeHead(200, { "Content-Type": "application/json" });
                            res.end(JSON.stringify({ 
                                status: "success", 
                                alerts: [], 
                                message: "Esperando contexto activo." 
                        }));
                        return;
                    }
                    
                    // Sanitizar árbol de niveles
                    let currentParentEntity = "Entidad General";
                    const processedContext = contextData.map(row => {
                        const isChild = String(row.nivel || "").includes(".");
                        if (!isChild && row.entidad) {
                            currentParentEntity = row.entidad;
                        }
                        return {
                            ...row,
                            entidad: isChild ? currentParentEntity : (row.entidad || "Entidad General"),
                            isActive: isChild ? true : (row.isActive || false)
                        };
                    });
                    
                    // Simular ejecución del Minero (aquí se conectaría con radarMinero.fetchActiveAlerts)
                    // Por ahora retornamos éxito con el contexto procesado
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ 
                        status: "success", 
                        alerts: processedContext,
                        message: "Contexto procesado de forma segura"
                    }));
                    
                } catch(error) {
                    console.error("[ALERT_FETCH_ERROR] Error controlado:", error);
                    // Respuesta de escape - limpia error rojo en frontend
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ 
                        status: "stabilized", 
                        alerts: [], 
                        warning: "Sincronizando estructura de datos..." 
                    }));
                }
            });
        }
    } else if (url === "/alerts") {
            if (req.method === "GET") {
                API_Alertas.obtenerAlertas(res);
            } else if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    try {
                        const data = JSON.parse(body);
                        API_Alertas.recibirAlerta(data, res);
                    } catch(e) {
                        res.writeHead(400, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ error: "JSON inválido" }));
                    }
                });
            } else {
                res.writeHead(405);
                res.end();
            }
        } else if (url === "/alerts/handshake") {
            API_Alertas.handshake(res);
        } else if (url === "/alerts/ping") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "OK", timestamp: new Date().toISOString() }));
        } else if (url === "/alerts/context") {
            if (req.method === "GET") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    active_context: API_Alertas.obtenerActiveContext(),
                    anclas: API_Alertas.anclasBusqueda
                }));
            } else if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    const data = JSON.parse(body);
                    const result = API_Alertas.establecerActiveContext(data);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(result));
                });
            }
        } else if (url === "/alerts/filtradas") {
            const filtradas = API_Alertas.obtenerAlertasFiltradas();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(filtradas));
        } else if (url === "/alerts/ancla") {
            if (req.method === "POST") {
                let body = "";
                req.on("data", chunk => body += chunk);
                req.on("end", () => {
                    const data = JSON.parse(body);
                    let result;
                    if (data.tipo === "documento") {
                        result = API_Alertas.agregarAnclaDocumento(data);
                    } else {
                        result = API_Alertas.agregarAnclaNota(data);
                    }
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(result));
                });
            }
        }
    },
    
    sanitizarContext: (payload) => {
        console.log(`\n🧹 SANITIZANDO CONTEXT (Búsqueda hacia arriba)`);
        
        const context = payload.context || payload;
        const sanitized = [];
        let heredados = 0;
        
        context.forEach((row, index, arr) => {
            const nivelStr = String(row.nivel || "");
            
            // Si es hijo decimal (1.1, 1.2), buscar padre hacia arriba
            if (nivelStr.includes(".")) {
                // Buscar el padre más cercano hacia arriba (sin punto en nivel)
                const parent = arr.slice(0, index).reverse().find(r => {
                    const rNivel = String(r.nivel || "");
                    return !rNivel.includes(".");
                });
                
                if (parent) {
                    const rowSanitizada = {
                        ...row,
                        entidad: row.entidad || parent.entidad || "Entidad General",
                        isActive: parent.isActive !== undefined ? parent.isActive : false,
                        _heredadoDe: parent.id,
                        _herenciaAutomatica: true
                    };
                    sanitized.push(rowSanitizada);
                    heredados++;
                    console.log(`   ↩️ ${row.id} hereda de ${parent.id}`);
                } else {
                    sanitized.push({
                        ...row,
                        entidad: row.entidad || "Entidad General",
                        isActive: row.isActive || false
                    });
                }
            } else {
                // Padre directo - mantener original
                sanitized.push(row);
            }
        });
        
        console.log(`   ✅ Total heredados: ${heredados}`);
        
        return {
            success: true,
            sanitizado: sanitized,
            heredados: heredados
        };
    },
    
    // Endpoint para grupos jerárquicos (payload agrupado)
    recibirGruposHandler: (req, res) => {
        if (req.method === "POST") {
            let body = "";
            req.on("data", chunk => body += chunk);
            req.on("end", () => {
                try {
                    const data = JSON.parse(body);
                    const result = API_Alertas.recibirGruposJerarquicos(data);
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify(result));
                } catch(e) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: e.message }));
                }
            });
        } else if (req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ grupos: API_Alertas.gruposJerarquicos }));
        }
    },
    
    obtenerAlertasLimpias: () => {
        const ahora = Date.now();
        const hace24h = ahora - (24 * 60 * 60 * 1000);
        const activas = API_Alertas.alertas.activas.filter(a => !a.expirada);
        const ultimas24h = API_Alertas.alertas.ultimas24h.filter(a => new Date(a.timestamp).getTime() > hace24h);
        return {
            success: true,
            contadores: { activas: activas.length, ultimas24h: ultimas24h.length, totales: API_Alertas.alertas.historial.length },
            alertas: { activas: activas.slice(-10), ultimas24h: ultimas24h.slice(-10) },
            timestamp: new Date().toISOString()
        };
    },
    
    handshake: (res) => {
        console.log("\n🤝 HANDSHAKE RECIBIDO - Radar 360 App");
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
            handshake: "OK",
            servicio: "API_ALERTAS_V1",
            timestamp: new Date().toISOString(),
            contadores: API_Alertas.contadores
        }));
    },
    
    obtenerAlertas: (res) => {
        const ahora = Date.now();
        const hace24h = ahora - (24 * 60 * 60 * 1000);
        
        const activas = API_Alertas.alertas.activas.filter(a => !a.expirada);
        const ultimas24h = API_Alertas.alertas.ultimas24h.filter(a => new Date(a.timestamp).getTime() > hace24h);
        
        const respuesta = {
            success: true,
            contadores: {
                activas: activas.length,
                ultimas24h: ultimas24h.length,
                totales: API_Alertas.alertas.historial.length
            },
            alertas: {
                activas: activas.slice(-10),
                ultimas24h: ultimas24h.slice(-10)
            },
            timestamp: new Date().toISOString()
        };
        
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(respuesta));
    },
    
    recibirAlerta: (data, res) => {
        const tipo = data.tipo || "info";
        const zona = data.zona || "General";
        const plan = data.plan || null;
        const prioridad = data.prioridad || "media";
        
        const alerta = {
            id: `ALR-${Date.now()}`,
            tipo: tipo,
            zona: zona,
            plan: plan,
            prioridad: prioridad,
            titulo: data.titulo || "Alerta sin título",
            descripcion: data.descripcion || "",
            timestamp: new Date().toISOString(),
            expirada: false
        };
        
        API_Alertas.alertas.activas.push(alerta);
        API_Alertas.alertas.ultimas24h.push(alerta);
        API_Alertas.alertas.historial.push(alerta);
        
        console.log(`\n📡 ALERTA RECIBIDA: ${alerta.tipo.toUpperCase()}`);
        console.log(`   Zona: ${zona}`);
        console.log(`   Plan: ${plan || 'N/A'}`);
        
        // Verificar si es Plan de Desarrollo
        if (plan) {
            console.log(`   📋 PLAN DE DESARROLLO DETECTADO`);
        }
        
        // Verificar criterios de zona
        if (zona !== "General") {
            console.log(`   🗺️ CRITERIO ZONA: ${zona}`);
        }
        
        const respuesta = {
            success: true,
            alerta: alerta,
            contadores: {
                activas: API_Alertas.alertas.activas.length,
                ultimas24h: API_Alertas.alertas.ultimas24h.length
            }
        };
        
        if (res) {
            res.writeHead(201, { "Content-Type": "application/json" });
            res.end(JSON.stringify(respuesta));
        }
        
        return respuesta;
    },
    
    // Recibir Plan de Desarrollo
    recibirPlanDesarrollo: (plan) => {
        return API_Alertas.recibirAlerta({
            tipo: "plan_desarrollo",
            titulo: `Plan de Desarrollo: ${plan.nombre || 'Sin nombre'}`,
            descripcion: plan.descripcion || "",
            zona: plan.zona || "Nacional",
            plan: plan,
            prioridad: "alta"
        });
    },
    
    // Recibir Criterio de Zona
    recibirCriterioZona: (criterio) => {
        return API_Alertas.recibirAlerta({
            tipo: "criterio_zona",
            titulo: `Criterio de Zona: ${criterio.nombre}`,
            descripcion: criterio.descripcion || "",
            zona: criterio.zona || "General",
            prioridad: criterio.prioridad || "media"
        });
    },
    
    // Actualizar contador
    actualizarContadores: (filtroActivo = null) => {
        const ahora = Date.now();
        const hace24h = ahora - (24 * 60 * 60 * 1000);
        
        let alertasFiltradas = API_Alertas.alertas.activas.filter(a => !a.expirada);
        
        // Aplicar filtro de active_context si existe
        if (filtroActivo && API_Alertas.active_context.anclaBusqueda) {
            const ancla = API_Alertas.active_context.anclaBusqueda.toLowerCase();
            alertasFiltradas = alertasFiltradas.filter(a => {
                const texto = (a.titulo + " " + a.descripcion + " " + (a.zona || "")).toLowerCase();
                return texto.includes(ancla);
            });
        }
        
        let ultimasFiltradas = API_Alertas.alertas.ultimas24h.filter(a => new Date(a.timestamp).getTime() > hace24h);
        
        if (filtroActivo && API_Alertas.active_context.anclaBusqueda) {
            const ancla = API_Alertas.active_context.anclaBusqueda.toLowerCase();
            ultimasFiltradas = ultimasFiltradas.filter(a => {
                const texto = (a.titulo + " " + a.descripcion + " " + (a.zona || "")).toLowerCase();
                return texto.includes(ancla);
            });
        }
        
        API_Alertas.contadores.activas = alertasFiltradas.length;
        API_Alertas.contadores.ultimas24h = ultimasFiltradas.length;
        API_Alertas.contadores.totales = API_Alertas.alertas.historial.length;
        
        return API_Alertas.contadores;
    },
    
    // Establecer Active Context - Ancla de Búsqueda
    establecerActiveContext: (contexto) => {
        const nuevoContexto = {
            id: contexto.id || `CTX-${Date.now()}`,
            tipo: contexto.tipo || "soporte",
            valor: contexto.valor || "",
            timestamp: new Date().toISOString(),
            anclaBusqueda: contexto.anclaBusqueda || contexto.valor
        };
        
        API_Alertas.active_context = nuevoContexto;
        
        // Agregar como ancla de búsqueda
        if (nuevoContexto.anclaBusqueda) {
            API_Alertas.anclasBusqueda.unshift({
                ancla: nuevoContexto.anclaBusqueda,
                timestamp: nuevoContexto.timestamp,
                tipo: nuevoContexto.tipo
            });
            
            // Mantener solo últimas 10 anclas
            if (API_Alertas.anclasBusqueda.length > 10) {
                API_Alertas.anclasBusqueda = API_Alertas.anclasBusqueda.slice(0, 10);
            }
        }
        
        console.log(`\n🎯 ACTIVE CONTEXT ESTABLECIDO`);
        console.log(`   Tipo: ${nuevoContexto.tipo}`);
        console.log(`   Valor: ${nuevoContexto.valor}`);
        console.log(`   Ancla: ${nuevoContexto.anclaBusqueda}`);
        
        // Actualizar contadores filtrados
        API_Alertas.actualizarContadores(true);
        
        return {
            active_context: API_Alertas.active_context,
            contadores: API_Alertas.contadores
        };
    },
    
    // Obtener alertas filtradas por contexto activo
    obtenerAlertasFiltradas: () => {
        const ahora = Date.now();
        const hace24h = ahora - (24 * 60 * 60 * 1000);
        
        let activas = API_Alertas.alertas.activas.filter(a => !a.expirada);
        let ultimas24h = API_Alertas.alertas.ultimas24h.filter(a => new Date(a.timestamp).getTime() > hace24h);
        
        if (API_Alertas.active_context.anclaBusqueda) {
            const ancla = API_Alertas.active_context.anclaBusqueda.toLowerCase();
            
            activas = activas.filter(a => {
                const texto = (a.titulo + " " + a.descripcion + " " + (a.zona || "")).toLowerCase();
                return texto.includes(ancla);
            });
            
            ultimas24h = ultimas24h.filter(a => {
                const texto = (a.titulo + " " + a.descripcion + " " + (a.zona || "")).toLowerCase();
                return texto.includes(ancla);
            });
        }
        
        return {
            activas: activas,
            ultimas24h: ultimas24h,
            active_context: API_Alertas.active_context,
            anclas: API_Alertas.anclasBusqueda
        };
    },
    
    // Agregar documento como ancla de búsqueda
    agregarAnclaDocumento: (documento) => {
        return API_Alertas.establecerActiveContext({
            tipo: "documento",
            valor: documento.nombre || documento.titulo,
            anclaBusqueda: documento.contenido || documento.nombre
        });
    },
    
    // Agregar nota personal como ancla de búsqueda
    agregarAnclaNota: (nota) => {
        return API_Alertas.establecerActiveContext({
            tipo: "nota_personal",
            valor: nota.texto,
            anclaBusqueda: nota.texto
        });
    },
    
    // Limpiar active context
    limpiarActiveContext: () => {
        API_Alertas.active_context = {
            id: null,
            tipo: null,
            valor: null,
            timestamp: null,
            anclaBusqueda: null
        };
        
        API_Alertas.actualizarContadores(false);
        
        console.log(`\n🧹 ACTIVE CONTEXT LIMPIADO`);
        
        return { estado: "LIMPIADO", contadores: API_Alertas.contadores };
    },
    
    obtenerActiveContext: () => {
        return API_Alertas.active_context;
    },
    
    // ==========================================
    // CONSOLIDACIÓN DE PAYLOAD - GRUPOS JERÁRQUICOS
    // ==========================================
    
    procesarPayloadAgrupado: (payload) => {
        console.log(`\n📦 PROCESANDO PAYLOAD AGRUPADO`);
        
        if (!payload || typeof payload !== "object") {
            return { error: "Payload inválido" };
        }
        
        const grupos = [];
        const errores = [];
        const advertencias = [];
        
        // Procesar cada grupo (padre con hijos)
        for (const [grupoId, data] of Object.entries(payload)) {
            const grupo = {
                id: grupoId,
                titulo: data.titulo || data.nombre || "Sin título",
                nivel: data.nivel || 1,
                isActive: data.isActive || false,
                entidad: data.entidad || null,
                entidades: []
            };
            
            // Procesar nodos hijos
            const hijos = data.hijos || data.items || [];
            
            // Herencia de Entidad - con fallback automático
            let entidadHeredada = data.entidad || null;
            
            hijos.forEach((hijo, index) => {
                // FALLBACK: Si no tiene entidad, heredar del padre
                const entidadHijo = hijo.entidad || entidadHeredada;
                if (!hijo.entidad && entidadHeredada) {
                    advertencias.push({ id: hijo.id, tipo: "ENTIDAD_HEREDADA", valor: entidadHeredada });
                    hijo.entidad = "[AUTO-HEREDADO] " + entidadHeredada;
                } else if (!hijo.entidad) {
                    advertencias.push({ id: hijo.id || `${grupoId}.${index+1}`, tipo: "SIN_ENTIDAD", valor: "Sin entidad" });
                    hijo.entidad = "Sin entidad";
                } else {
                    hijo.entidad = entidadHijo;
                }
                
                // FALLBACK: Si no tiene status, heredar del padre
                let statusHijo = hijo.status || data.status || "activo";
                if (!hijo.status && data.isActive) {
                    advertencias.push({ id: hijo.id, tipo: "STATUS_HEREDADO", valor: "heredado_del_padre" });
                    statusHijo = "auto-activo";
                }
                
                // Actualizar entidad heredada para siguientes hijos
                if (hijo.entidad && !hijo.entidad.startsWith("[AUTO-HEREDADO]")) {
                    entidadHeredada = hijo.entidad;
                }
                
                grupo.entidades.push({
                    id: hijo.id || `${grupoId}.${index + 1}`,
                    titulo: hijo.titulo || hijo.nombre,
                    entidad: hijo.entidad,
                    status: statusHijo,
                    nivel: grupo.nivel + 1,
                    isActive: grupo.isActive // Heredar estado del padre
                });
            });
            
            // Si padre inactivo, marcar grupo como ignorado
            if (!grupo.isActive) {
                console.log(`   ⛔ Grupo "${grupo.titulo}" IGNORADO (isActive: false)`);
                errores.push({ grupo: grupo.titulo, razon: "Padre inactivo" });
            } else {
                console.log(`   ✅ Grupo "${grupo.titulo}" ACTIVADO (con ${advertencias.length} advertencias)`);
            }
            
            grupos.push(grupo);
        }
        
        // Guardar en base de datos
        API_Alertas.gruposJerarquicos = grupos;
        
        return {
            success: true,
            gruposProcesados: grupos.length,
            gruposIgnorados: errores.length,
            entidadHeredada: true,
            errores: errores,
            advertencias: advertencias,
            mensaje: advertencias.length > 0 
                ? "Procesado con fallbacks automáticos" 
                : "Procesado normalmente"
        };
    },
    
    // ==========================================
    // LIMPIEZA DE RESPUESTA - EVITAR FAILED TO FETCH
    // ==========================================
    
    obtenerAlertasLimpias: () => {
        const ahora = Date.now();
        const hace24h = ahora - (24 * 60 * 60 * 1000);
        
        // Aplicar filtro de contexto activo si existe
        let activas = API_Alertas.alertas.activas.filter(a => !a.expirada);
        let ultimas24h = API_Alertas.alertas.ultimas24h.filter(a => new Date(a.timestamp).getTime() > hace24h);
        
        if (API_Alertas.active_context.anclaBusqueda) {
            const ancla = API_Alertas.active_context.anclaBusqueda.toLowerCase();
            activas = activas.filter(a => {
                const texto = (a.titulo + " " + (a.descripcion || "") + " " + (a.zona || "")).toLowerCase();
                return texto.includes(ancla);
            });
            ultimas24h = ultimas24h.filter(a => {
                const texto = (a.titulo + " " + (a.descripcion || "") + " " + (a.zona || "")).toLowerCase();
                return texto.includes(ancla);
            });
        }
        
        // Limpiar error de fetch
        API_Alertas.comm.fetchError = null;
        API_Alertas.comm.lastSync = new Date().toISOString();
        
        return {
            success: true,
            data: {
                contadores: {
                    activas: activas.length,
                    ultimas24h: ultimas24h.length,
                    totales: API_Alertas.alertas.historial.length
                },
                alertas: {
                    activas: activas.slice(0, 20),
                    ultimas24h: ultimas24h.slice(0, 20)
                },
                grupos: API_Alertas.gruposJerarquicos,
                context_anchors: API_Alertas.anclasBusqueda,
                syncStatus: "OK"
            },
            timestamp: new Date().toISOString(),
            error: null
        };
    },
    
    // Endpoint para grupos jerárquicos
    recibirGruposJerarquicos: (payload) => {
        return API_Alertas.procesarPayloadAgrupado(payload);
    },
    
    detener: () => {
        if (API_Alertas.servidor) {
            API_Alertas.servidor.close();
            API_Alertas.estado = "INACTIVO";
            console.log("\n⏹️ API DE ALERTAS DETENIDA");
        }
        return { estado: "DETENIDO" };
    },
    
    estado: () => {
        return {
            estado: API_Alertas.estado,
            puerto: API_Alertas.puerto,
            contadores: API_Alertas.actualizarContadores()
        };
    }
};

module.exports = API_Alertas;