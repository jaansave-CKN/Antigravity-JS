export default function TerminosPage() {
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px', fontFamily: "'Public Sans', sans-serif", color: '#191c1e', lineHeight: 1.6 }}>
      <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '12px 16px', marginBottom: 28, fontSize: 13, color: '#92400e' }}>
        <strong>Borrador base — no publicar sin revisión legal.</strong> Este documento es una plantilla estructural para RadFor-360. Los campos entre corchetes [ ] deben completarse y todo el texto debe ser revisado por un abogado antes de entrar en vigencia real.
      </div>

      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Términos y Condiciones de Uso</h1>
      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 24 }}>Última actualización: [FECHA] · Versión 0.1 (borrador)</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>1. Identificación del prestador del servicio</h2>
      <p>RadFor-360 (en adelante, "la Plataforma") es operado por [RAZÓN SOCIAL], identificado con NIT [NIT], con domicilio en [CIUDAD, COLOMBIA], correo de contacto [EMAIL DE CONTACTO].</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>2. Objeto del servicio</h2>
      <p>RadFor-360 es una plataforma SaaS para la formulación, estructuración, evaluación de viabilidad y postulación de proyectos de inversión ante entidades territoriales, organizaciones no gubernamentales, fundaciones y organismos de cooperación, dirigida a personas naturales, personas jurídicas, ONG y fundaciones. La Plataforma no ofrece asesoría jurídica, financiera ni de ingeniería certificada — las herramientas de inteligencia artificial (viabilidad, motor dialéctico, generación de enfoque narrativo) son apoyos de trabajo, no dictámenes profesionales vinculantes.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>3. Registro y cuenta de usuario</h2>
      <p>El usuario es responsable de la veracidad de la información suministrada al registrarse y de la confidencialidad de sus credenciales de acceso. El uso de la cuenta es intransferible. [RAZÓN SOCIAL] podrá suspender cuentas que incumplan estos Términos o que se usen para actividades fraudulentas o ilegales.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>4. Planes, pagos y facturación</h2>
      <p>El acceso a los módulos de la Plataforma (Radar, Formulador, Suite) está sujeto a planes de suscripción pagos, procesados a través de un proveedor de pagos externo (Stripe). Los precios se muestran en Pesos Colombianos (COP) salvo indicación expresa en contrario. [DEFINIR: política de reembolsos, renovación automática, cancelación, período de prueba si aplica.]</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>5. Propiedad intelectual</h2>
      <p>El contenido generado por el usuario (fichas técnicas, presupuestos, anexos, narrativas) es propiedad del usuario. El software, marca, diseño y estructura de la Plataforma son propiedad de [RAZÓN SOCIAL]. El uso de inteligencia artificial (Gemini/Google) para generar texto no transfiere derechos de autor sobre modelos de terceros.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>6. Limitación de responsabilidad</h2>
      <p>La información de convocatorias, montos y fechas límite mostrada en el módulo Radar proviene de fuentes públicas de terceros (entidades gubernamentales, bancos multilaterales, fundaciones) y puede contener errores, quedar desactualizada o ser retirada por la entidad emisora sin previo aviso. [RAZÓN SOCIAL] no garantiza la exactitud, vigencia ni elegibilidad de dicha información y recomienda verificarla directamente con la entidad convocante antes de radicar cualquier postulación. Los análisis de viabilidad generados por inteligencia artificial son estimaciones automatizadas y no constituyen garantía de aprobación ante ninguna entidad financiadora.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>7. Tratamiento de datos personales</h2>
      <p>El tratamiento de datos personales de los usuarios se rige por la <a href="/privacidad" style={{ color: '#0041a3' }}>Política de Tratamiento de Datos Personales</a>, conforme a la Ley 1581 de 2012 y el Decreto 1377 de 2013.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>8. Modificaciones</h2>
      <p>[RAZÓN SOCIAL] podrá modificar estos Términos en cualquier momento, notificando a los usuarios activos con [X] días de antelación mediante correo electrónico o aviso en la Plataforma.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>9. Ley aplicable y jurisdicción</h2>
      <p>Estos Términos se rigen por las leyes de la República de Colombia. Cualquier controversia se someterá a los jueces competentes de [CIUDAD], Colombia.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>10. Contacto</h2>
      <p>Para consultas sobre estos Términos: [EMAIL DE CONTACTO].</p>
    </div>
  );
}
