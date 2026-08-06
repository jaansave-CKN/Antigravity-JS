import { FLAGS } from "./config.js";
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, serverTimestamp, query, orderBy, limit, getDocs, deleteDoc, doc } from 'firebase/firestore';

const PROJECTS_BASE_PATH = "proyectos";
const DEBOUNCE_TIME = 2000;
const MAX_SNAPSHOTS = 5;

const firebaseConfig = {
    apiKey: "AIzaSyBdaIbBKlPn1yTxB2g7zuycPk-B1WF9TPk",
    authDomain: "antigravity-jairo-2026.firebaseapp.com",
    projectId: "antigravity-jairo-2026",
    storageBucket: "antigravity-jairo-2026.firebasestorage.app",
    messagingSenderId: "48939331003",
    appId: "1:48939331003:web:450caf121f1b53693b689e"
};

let app, db;
try {
    app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    window.db = db;
} catch (e) {
    console.warn("Firebase init skipped (already initialized):", e.message);
}

class Agente001 {
    constructor() {
        this.flag = FLAGS.DATA_IDLE;
        this.snapshots = [];
        this.snapshotHistory = [];
        this.maxSnapshots = MAX_SNAPSHOTS;
        this.activeProject = { id: null, name: null };
        this.debounceTimer = null;
    }

    async switchProject(targetID) {
        const hasUnsaved = this.hasUnsavedChanges();
        
        if (hasUnsaved) {
            const confirm = window.confirm("Hay cambios sin guardar. ¿Deseas cerrar el proyecto actual?");
            if (!confirm) return false;
        }

        this.clearHistory();
        console.log(`Borrando caché de proyek aktif...`);

        this.activeProject.id = targetID;
        this.activeProject.name = await this.getProjectName(targetID);
        
        this.setStoragePath(`${PROJECTS_BASE_PATH}/${targetID}/`);
        
        await this.ensureProjectFolder(targetID);

        if (window.ContextManager) {
            window.ContextManager.activeProject = {
                id: this.activeProject.id,
                name: this.activeProject.name
            };
            window.ContextManager.updateUIHeader();
        }

        console.log(`✅ Antigravity OS: Trabajando ahora en ${targetID}`);
        return true;
    }

    async ensureProjectFolder(projectID) {
        const fs = window.fs || await this.getFileSystem();
        if (!fs) {
            console.warn("FileSystem no disponible, verificando manualmente...");
            return;
        }

        try {
            await fs.mkdir(`${PROJECTS_BASE_PATH}/${projectID}`, { recursive: true });
            console.log(`✅ Subcarpeta creada: ${projectID}`);
        } catch (error) {
            if (error.code !== "EEXIST") {
                console.error("Error creando carpeta:", error);
            } else {
                console.log(`📁 Carpeta existente: ${projectID}`);
            }
        }
    }

    async getFileSystem() {
        if (window.fs) return window.fs;
        
        try {
            const { default: fs } = await import("fs");
            window.fs = fs;
            return fs;
        } catch {
            return null;
        }
    }

    getProjectName(targetID) {
        const normalized = targetID.toLowerCase();
        const names = {
            "proy_01_donaciones": "Donaciones",
            "proy_02_rural_bolivar": "Rural Bolívar",
            "proy_03_modulares": "Modulares"
        };
        return names[normalized] || targetID;
    }

    setStoragePath(path) {
        this.storagePath = path;
        if (window.director050) {
            window.director050.updateProjectTitle(this.activeProject.name || this.getProjectName(this.activeProject.id));
        }
    }

    getStoragePath() {
        return this.storagePath || PROJECTS_BASE_PATH + "/";
    }

    hasUnsavedChanges() {
        return this.snapshots.length > 0 && 
               this.snapshots[0]?.timestamp > Date.now() - 300000;
    }

    clearHistory() {
        this.snapshots = [];
        this.snapshotHistory = [];
    }

    setFlag(newFlag) {
        this.flag = newFlag;
        this.notifyDirector();
    }

    notifyDirector() {
        if (window.director050) {
            window.director050.onAgente001Status(this.flag);
        }
    }

    async processLink(link) {
        this.setFlag(FLAGS.OCR_PENDING);
        this.createSnapshot("pre-procesamiento");

        try {
            this.setFlag(FLAGS.OCR_PROCESSING);
            const data = await this.extractData(link);
            
            if (this.isValid(data)) {
                this.setFlag(FLAGS.OCR_READY);
                this.createSnapshot("post-extraccion");
                return data;
            } else {
                throw new Error("Datos extraídos no válidos");
            }
        } catch (error) {
            this.setFlag(FLAGS.OCR_ERROR);
            console.error("Error en Agente 001:", error);
            throw error;
        }
    }

    async extractData(link) {
        await new Promise(r => setTimeout(r, 1000));
        return { link, timestamp: Date.now(), content: "datos_extraidos" };
    }

    isValid(data) {
        return data && data.content && data.timestamp;
    }

    createSnapshot(stage) {
        const snapshot = {
            stage,
            timestamp: Date.now(),
            flag: this.flag,
            data: this.getCurrentData(),
            projectId: this.activeProject.id
        };

        this.snapshots.unshift(snapshot);

        if (this.snapshots.length > this.maxSnapshots) {
            this.snapshots.pop();
        }

        this.debouncedSaveSnapshot(snapshot);
    }

    debouncedSaveSnapshot(snapshot) {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(async () => {
            await this.saveSnapshotToFirebase(snapshot);
        }, DEBOUNCE_TIME);
    }

    async saveSnapshotToFirebase(snapshot) {
        if (!db) {
            console.warn("Firebase db no disponible, guardando en memoria");
            this.snapshotHistory.unshift(snapshot);
            this.enforceSnapshotLimit();
            return;
        }

        try {
            const docRef = await addDoc(collection(db, "snapshots"), {
                stage: snapshot.stage,
                timestamp: snapshot.timestamp,
                flag: snapshot.flag,
                projectId: snapshot.projectId || this.activeProject.id,
                createdAt: serverTimestamp()
            });
            
            this.snapshotHistory.unshift({
                ...snapshot,
                firestoreId: docRef.id
            });
            
            this.enforceSnapshotLimit();
            console.log("✅ Snapshot guardado en Firebase:", docRef.id);
        } catch (error) {
            console.error("Error guardando snapshot en Firebase:", error);
            this.snapshotHistory.unshift(snapshot);
            this.enforceSnapshotLimit();
        }
    }

    enforceSnapshotLimit() {
        while (this.snapshotHistory.length > MAX_SNAPSHOTS) {
            const removed = this.snapshotHistory.pop();
            if (removed?.firestoreId && db) {
                deleteDoc(doc(db, "snapshots", removed.firestoreId)).catch(() => {});
            }
        }
    }

    async loadSnapshotsFromFirebase() {
        if (!db || !this.activeProject.id) return;

        try {
            const q = query(
                collection(db, "snapshots"),
                orderBy("timestamp", "desc"),
                limit(MAX_SNAPSHOTS)
            );
            const snapshot = await getDocs(q);
            
            this.snapshotHistory = snapshot.docs.map(doc => ({
                ...doc.data(),
                firestoreId: doc.id
            }));
        } catch (error) {
            console.error("Error cargando snapshots:", error);
        }
    }

    getCurrentData() {
        return window.currentExtractedData || {};
    }

    recoverSnapshot(index) {
        if (index >= 0 && index < this.snapshots.length) {
            const snapshot = this.snapshots[index];
            console.log(`Recuperando snapshot nivel ${index + 1}: ${snapshot.stage}`);
            return snapshot.data;
        }
        return null;
    }

    canOverwrite(field) {
        return !this.getCurrentData()[field];
    }
}

window.Agente001 = new Agente001();
export default Agente001;