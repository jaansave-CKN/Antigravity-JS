export default function PrivacidadPage() {
  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '32px 24px', fontFamily: "'Public Sans', sans-serif", color: '#191c1e', lineHeight: 1.6 }}>
      <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', borderRadius: 8, padding: '12px 16px', marginBottom: 28, fontSize: 13, color: '#92400e' }}>
        <strong>Borrador base — no publicar sin revisión legal.</strong> Este documento cubre los elementos mínimos exigidos por la Ley 1581 de 2012 y el Decreto 1377 de 2013, pero los campos entre corchetes [ ] deben completarse (identificación real del responsable, correo del área encargada) y el contenido debe ser validado por un abogado antes de entrar en vigencia.
      </div>

      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4 }}>Política de Tratamiento de Datos Personales</h1>
      <p style={{ fontSize: 12, color: '#6b7280', marginBottom: 24 }}>Última actualización: [FECHA] · Versión 0.1 (borrador) · Conforme a la Ley 1581 de 2012 y el Decreto 1377 de 2013 (Colombia)</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>1. Responsable del tratamiento</h2>
      <p>
        Razón social: [RAZÓN SOCIAL]<br />
        NIT: [NIT]<br />
        Domicilio: [DIRECCIÓN, CIUDAD, COLOMBIA]<br />
        Correo de contacto para temas de datos personales: [EMAIL DE CONTACTO DATOS]
      </p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>2. Datos que recolectamos</h2>
      <p>Al usar RadFor-360 podemos recolectar: nombre completo, correo electrónico, contraseña (almacenada cifrada, nunca en texto plano), datos de los proyectos que formule (población objetivo, ubicación geográfica, presupuestos, diagnósticos), documentos y anexos que adjunte (TDRs, PDFs, evidencias), y datos técnicos de uso (dirección IP, tipo de navegador, fecha/hora de acceso) para fines de seguridad.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>3. Finalidades del tratamiento</h2>
      <ul>
        <li>Crear y administrar la cuenta de usuario y su acceso a la Plataforma.</li>
        <li>Prestar los servicios de formulación, evaluación de viabilidad y postulación de proyectos.</li>
        <li>Procesar pagos de suscripción a través de nuestro proveedor de pagos (Stripe).</li>
        <li>Enviar notificaciones transaccionales (bienvenida, recuperación de contraseña, alertas de convocatorias) y, solo si el usuario lo autoriza expresamente, comunicaciones comerciales.</li>
        <li>Generar análisis automatizados de viabilidad mediante modelos de inteligencia artificial de terceros (Google Gemini) — el contenido narrativo de sus proyectos puede ser enviado a ese proveedor para su procesamiento, bajo los términos de privacidad de Google.</li>
        <li>Cumplir obligaciones legales y atender requerimientos de autoridades competentes.</li>
      </ul>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>4. Encargados y transferencia de datos</h2>
      <p>Sus datos son almacenados y procesados por: Supabase Inc. (base de datos y almacenamiento de archivos, con servidores que pueden estar ubicados fuera de Colombia), Stripe Inc. (procesamiento de pagos) y Google LLC (procesamiento de lenguaje natural para las funciones de inteligencia artificial). Estas transferencias internacionales se realizan bajo los estándares de protección exigidos por la Superintendencia de Industria y Comercio (SIC) para este tipo de encargados.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>5. Derechos del titular de los datos</h2>
      <p>Como titular de sus datos personales, usted tiene derecho a:</p>
      <ul>
        <li>Conocer, actualizar y rectificar sus datos personales.</li>
        <li>Solicitar prueba de la autorización otorgada para el tratamiento de sus datos.</li>
        <li>Ser informado sobre el uso que se ha dado a sus datos personales.</li>
        <li>Revocar la autorización y/o solicitar la supresión de sus datos, cuando no exista un deber legal o contractual que impida su eliminación.</li>
        <li>Acceder de forma gratuita a sus datos personales que hayan sido objeto de tratamiento.</li>
        <li>Presentar quejas ante la Superintendencia de Industria y Comercio por infracciones a la ley de protección de datos.</li>
      </ul>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>6. Procedimiento para ejercer sus derechos</h2>
      <p>Las consultas, reclamos o solicitudes relacionadas con sus datos personales pueden dirigirse a [EMAIL DE CONTACTO DATOS]. Las consultas serán atendidas en un término máximo de diez (10) días hábiles contados a partir de la fecha de recibo, y los reclamos en un término máximo de quince (15) días hábiles, prorrogable por ocho (8) días hábiles adicionales cuando no sea posible atenderlo dentro de dicho plazo, conforme lo establece la Ley 1581 de 2012.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>7. Seguridad de la información</h2>
      <p>Implementamos medidas técnicas y organizativas razonables para proteger sus datos personales contra pérdida, uso indebido o acceso no autorizado, incluyendo cifrado de contraseñas, control de acceso basado en autenticación por token, y aislamiento de la información entre distintos clientes de la Plataforma (arquitectura multi-tenant).</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>8. Vigencia</h2>
      <p>Esta política rige a partir de [FECHA] y permanecerá vigente mientras se realice tratamiento de datos personales conforme a las finalidades descritas, o hasta que sea sustituida por una versión posterior publicada en la Plataforma.</p>

      <h2 style={{ fontSize: 18, fontWeight: 700, marginTop: 24 }}>9. Contacto</h2>
      <p>Para ejercer sus derechos como titular de datos personales: [EMAIL DE CONTACTO DATOS].</p>
    </div>
  );
}
