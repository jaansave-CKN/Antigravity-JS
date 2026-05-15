import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';

admin.initializeApp();

const db = admin.firestore();

interface Convocatoria {
  id: string;
  titulo: string;
  donante: string;
  montoMax: number;
  moneda: string;
  fechaCierre: string;
  fechaPublicacion: string;
  paisesElegibles: string[];
  sectores: string[];
  probabilidadExito: number;
  requisitosClave: string[];
  estado: string;
  fuente: string;
  descripcion: string;
  urlOriginal: string;
  urlConvocatoria: string;
  favorito: boolean;
  compatibilidadPerfil: number;
}

// Buscar convocatorias (simulado - en realidad usaría una API de búsqueda)
async function buscarConvocatorias(): Promise<Convocatoria[]> {
  // Acá iría la lógica de búsqueda real
  // Por ahora devuelve un array vacío - se填充aría con API real
  return [];
}

// Función HTTP para búsqueda manual
export const buscarConvocatoriasHTTP = functions.https.onRequest(async (req, res) => {
  try {
    const convocatorias = await buscarConvocatorias();
    
    // Guardar en Firestore
    const batch = db.batch();
    for (const conv of convocatorias) {
      const docRef = db.collection('convocatorias').doc(conv.id);
      batch.set(docRef, conv);
    }
    await batch.commit();
    
    res.json({ 
      success: true, 
      message: `Se encontraron ${convocatorias.length} convocatorias`,
      data: convocatorias 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: String(error) 
    });
  }
});

// Scheduled function - runs every 6 hours
export const radarAutomatico = functions.pubsub
  .schedule('every 6 hours')
  .onRun(async (context) => {
    console.log('Iniciando radar automático...');
    
    const convocatorias = await buscarConvocatorias();
    
    if (convocatorias.length > 0) {
      const batch = db.batch();
      for (const conv of convocatorias) {
        const docRef = db.collection('convocatorias').doc(conv.id);
        batch.set(docRef, conv);
      }
      await batch.commit();
      console.log(`Se guardaron ${convocatorias.length} nuevas convocatorias`);
    }
    
    return null;
  });

// Función para agregar convocatoria manualmente
export const agregarConvocatoria = functions.https.onCall(async (data, context) => {
  const conv: Convocatoria = data;
  
  await db.collection('convocatorias').doc(conv.id).set(conv);
  
  return { success: true, message: 'Convocatoria guardada' };
});

// Obtener todas las convocatorias
export const getConvocatorias = functions.https.onCall(async (data, context) => {
  const snapshot = await db.collection('convocatorias').get();
  const convocatorias: Convocatoria[] = [];
  
  snapshot.forEach(doc => {
    convocatorias.push(doc.data() as Convocatoria);
  });
  
  return { data: convocatorias };
});