export default function TerminosPage() {
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px', fontFamily: "'Public Sans', sans-serif", color: '#191c1e', lineHeight: 1.6 }}>
      <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '12px 16px', marginBottom: 28, fontSize: 13, color: '#92400e' }}>
        <strong>Borrador base — no publicar sin revisión legal.</strong> Los datos de identificación del operador y las cláusulas comerciales (reembolsos, renovación, notificación de cambios) ya están redactados con valores reales; el texto completo debe ser revisado por un abogado antes de entrar en vigencia real.
      </div>

      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Términos y Condiciones de Uso</h1>
      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 24 }}>Última actualización: 2026-09-07 · Versión 0.1 (borrador)</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>1. Identificación del prestador del servicio</h2>
      <p>RadFor-360 (en adelante, "la Plataforma") es operado por JAIRO SALINAS VELASCO, identificado con NIT 91477168-1, con domicilio en Bucaramanga, Colombia, correo de contacto jaansave@gmail.com.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>2. Objeto del servicio</h2>
      <p>RadFor-360 es una plataforma SaaS para la formulación, estructuración, evaluación de viabilidad y postulación de proyectos de inversión ante entidades territoriales, organizaciones no gubernamentales, fundaciones y organismos de cooperación, dirigida a personas naturales, personas jurídicas, ONG y fundaciones. La Plataforma no ofrece asesoría jurídica, financiera ni de ingeniería certificada — las herramientas de inteligencia artificial (viabilidad, motor dialéctico, generación de enfoque narrativo) son apoyos de trabajo, no dictámenes profesionales vinculantes.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>3. Registro y cuenta de usuario</h2>
      <p>El usuario es responsable de la veracidad de la información suministrada al registrarse y de la confidencialidad de sus credenciales de acceso. El uso de la cuenta es intransferible. JAIRO SALINAS VELASCO podrá suspender cuentas que incumplan estos Términos o que se usen para actividades fraudulentas o ilegales.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>4. Planes, pagos y facturación</h2>
      <p>El acceso a los módulos de la Plataforma (Radar, Formulador, Suite) está sujeto a planes de suscripción pagos, procesados a través de un proveedor de pagos externo (Stripe y/o Wompi). Los precios se muestran en Pesos Colombianos (COP) salvo indicación expresa en contrario.</p>
      <p><strong>Política de reembolsos:</strong> al tratarse de servicios digitales de software en la nube bajo demanda (SaaS), las suscripciones no son reembolsables una vez activado el periodo de cobro, salvo fallas técnicas imputables a la Plataforma que sean reportadas y comprobadas dentro de las 48 horas siguientes a dicha activación.</p>
      <p><strong>Renovación y cancelación:</strong> las suscripciones se renuevan automáticamente al final de cada periodo de facturación, salvo que el usuario cancele desde su cuenta antes de la fecha de renovación. La cancelación no genera reembolso del periodo ya facturado, pero el acceso permanece activo hasta el final de dicho periodo.</p>
      <p><strong>Período de prueba:</strong> la Plataforma ofrece un modo de exploración gratuito de 24 horas, sin registro ni método de pago, con funcionalidad limitada. Este modo no constituye un período de prueba de los planes pagos ni genera obligación de cobro posterior.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>5. Propiedad intelectual</h2>
      <p>El contenido generado por el usuario (fichas técnicas, presupuestos, anexos, narrativas) es propiedad del usuario. El software, marca, diseño y estructura de la Plataforma son propiedad de JAIRO SALINAS VELASCO. El uso de inteligencia artificial (Gemini/Google) para generar texto no transfiere derechos de autor sobre modelos de terceros.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>6. Limitación de responsabilidad</h2>
      <p>La información de convocatorias, montos y fechas límite mostrada en el módulo Radar proviene de fuentes públicas de terceros (entidades gubernamentales, bancos multilaterales, fundaciones) y puede contener errores, quedar desactualizada o ser retirada por la entidad emisora sin previo aviso. JAIRO SALINAS VELASCO no garantiza la exactitud, vigencia ni elegibilidad de dicha información y recomienda verificarla directamente con la entidad convocante antes de radicar cualquier postulación. Los análisis de viabilidad generados por inteligencia artificial son estimaciones automatizadas y no constituyen garantía de aprobación ante ninguna entidad financiadora.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>7. Tratamiento de datos personales</h2>
      <p>El tratamiento de datos personales de los usuarios se rige por la <a href="/privacidad" style={{ color: '#0041a3' }}>Política de Tratamiento de Datos Personales</a>, conforme a la Ley 1581 de 2012 y el Decreto 1377 de 2013.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>8. Modificaciones</h2>
      <p>JAIRO SALINAS VELASCO podrá modificar estos Términos en cualquier momento, notificando a los usuarios activos con un mínimo de 15 días calendario de antelación a su entrada en vigor, mediante correo electrónico o aviso en la Plataforma.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>9. Ley aplicable y jurisdicción</h2>
      <p>Estos Términos se rigen por las leyes de la República de Colombia. Cualquier controversia se someterá a los jueces competentes de Bucaramanga, Colombia.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>10. Contacto</h2>
      <p>Para consultas sobre estos Términos: jaansave@gmail.com.</p>
    </div>
  );
}
