// Sintaxis de personalización por plataforma de envío.
//
// En el editor las variables se escriben en formato canónico:
//   {{nombre}}                 variable
//   {{nombre|"amigo"}}         variable con valor por defecto
//   {{@unsubscribe}}           URL de baja
//   {{@preferences}}           URL de preferencias
//   {{@webversion}}            URL de versión web
//   {{#if nombre}} … {{else}} … {{/if}}   condicional
//
// Al exportar se traducen a la sintaxis de la plataforma elegida.
// Verifique siempre la documentación vigente de la plataforma antes de un envío masivo.

export interface Platform {
  id: string;
  name: string;
  /** Nombre por defecto del campo en la plataforma a partir de la clave canónica. */
  defaultName: (key: string) => string;
  variable: (name: string, fallback: string) => string;
  unsubscribe: string;
  preferences: string | null;
  webversion: string | null;
  ifStart: ((name: string) => string) | null;
  ifElse: string | null;
  /** "__NAME__" se reemplaza por el nombre de la variable del if correspondiente. */
  ifEnd: string | null;
  notes: string;
  docs: string;
}

export interface CustomPlatformConfig {
  /** Patrón de variable. {name} = nombre del campo, {fallback} = valor por defecto. */
  variablePattern: string;
  variableWithFallbackPattern: string;
  uppercase: boolean;
  unsubscribe: string;
  preferences: string;
  webversion: string;
  ifStart: string; // usa {name}
  ifElse: string;
  ifEnd: string;
}

export const DEFAULT_CUSTOM_PLATFORM: CustomPlatformConfig = {
  variablePattern: "[[{name}]]",
  variableWithFallbackPattern: "[[{name}|{fallback}]]",
  uppercase: false,
  unsubscribe: "[[unsubscribe_url]]",
  preferences: "",
  webversion: "",
  ifStart: "",
  ifElse: "",
  ifEnd: "",
};

const upper = (k: string) => k.toUpperCase().replace(/[^A-Z0-9_]/g, "_");
const same = (k: string) => k;
const q = (s: string) => s.replace(/"/g, '\\"');

export const PLATFORMS: Platform[] = [
  {
    id: "generic",
    name: "Genérico (marcadores {VARIABLE})",
    defaultName: upper,
    variable: (n) => `{${n}}`,
    unsubscribe: "{ENLACE_BAJA}",
    preferences: "{ENLACE_PREFERENCIAS}",
    webversion: "{VER_EN_WEB}",
    ifStart: null,
    ifElse: null,
    ifEnd: null,
    notes:
      "Marcadores neutros. Reemplácelos por las variables de su plataforma antes de enviar.",
    docs: "",
  },
  {
    id: "sendgrid",
    name: "SendGrid (Dynamic Templates / Handlebars)",
    defaultName: same,
    variable: (n, f) =>
      f ? `{{#if ${n}}}{{${n}}}{{else}}${f}{{/if}}` : `{{${n}}}`,
    unsubscribe: "<%asm_group_unsubscribe_raw_url%>",
    preferences: "<%asm_preferences_raw_url%>",
    webversion: "{{Weblink}}",
    ifStart: (n) => `{{#if ${n}}}`,
    ifElse: "{{else}}",
    ifEnd: "{{/if}}",
    notes:
      "Las variables vienen de dynamic_template_data. Cree un Unsubscribe Group y asócielo al envío.",
    docs: "https://www.twilio.com/docs/sendgrid/for-developers/sending-email/using-handlebars",
  },
  {
    id: "mailchimp",
    name: "Mailchimp (merge tags *|TAG|*)",
    defaultName: (k) => upper(k).slice(0, 10),
    variable: (n) => `*|${n}|*`,
    unsubscribe: "*|UNSUB|*",
    preferences: "*|UPDATE_PROFILE|*",
    webversion: "*|ARCHIVE|*",
    ifStart: (n) => `*|IF:${n}|*`,
    ifElse: "*|ELSE:|*",
    ifEnd: "*|END:IF|*",
    notes:
      "Los valores por defecto se configuran en los campos de la audiencia (Audience fields), no en el HTML.",
    docs: "https://mailchimp.com/help/all-the-merge-tags-cheat-sheet/",
  },
  {
    id: "brevo",
    name: "Brevo (ex Sendinblue)",
    defaultName: upper,
    variable: (n, f) =>
      f ? `{{ contact.${n} | default : "${q(f)}" }}` : `{{ contact.${n} }}`,
    unsubscribe: "{{ unsubscribe }}",
    preferences: "{{ update_profile }}",
    webversion: "{{ mirror }}",
    ifStart: (n) => `{% if contact.${n} %}`,
    ifElse: "{% else %}",
    ifEnd: "{% endif %}",
    notes: "Los atributos de contacto van en mayúsculas (FIRSTNAME, LASTNAME…).",
    docs: "https://help.brevo.com/hc/en-us/articles/4402386448530",
  },
  {
    id: "hubspot",
    name: "HubSpot (HubL)",
    defaultName: (k) => k.toLowerCase(),
    variable: (n, f) =>
      f
        ? `{{ contact.${n}|default("${q(f)}") }}`
        : `{{ contact.${n} }}`,
    unsubscribe: "{{ unsubscribe_link }}",
    preferences: "{{ unsubscribe_link }}",
    webversion: "{{ view_as_page_url }}",
    ifStart: (n) => `{% if contact.${n} %}`,
    ifElse: "{% else %}",
    ifEnd: "{% endif %}",
    notes:
      "Use el nombre interno de la propiedad (p. ej. firstname). Para HTML personalizado se requiere un módulo o plantilla codificada.",
    docs: "https://developers.hubspot.com/docs/cms/hubl/variables",
  },
  {
    id: "mailgun",
    name: "Mailgun (Handlebars templates)",
    defaultName: same,
    variable: (n, f) =>
      f ? `{{#if ${n}}}{{${n}}}{{else}}${f}{{/if}}` : `{{${n}}}`,
    unsubscribe: "%unsubscribe_url%",
    preferences: null,
    webversion: null,
    ifStart: (n) => `{{#if ${n}}}`,
    ifElse: "{{else}}",
    ifEnd: "{{/if}}",
    notes:
      "Para envíos por lotes con recipient-variables use %recipient.campo% en lugar de Handlebars.",
    docs: "https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/send-templates",
  },
  {
    id: "ses",
    name: "Amazon SES (templates Handlebars)",
    defaultName: same,
    variable: (n, f) =>
      f ? `{{#if ${n}}}{{${n}}}{{else}}${f}{{/if}}` : `{{${n}}}`,
    unsubscribe: "{{amazonSESUnsubscribeUrl}}",
    preferences: null,
    webversion: null,
    ifStart: (n) => `{{#if ${n}}}`,
    ifElse: "{{else}}",
    ifEnd: "{{/if}}",
    notes:
      "La baja depende de su configuración (listas de contactos de SES o su propio endpoint). Revise el marcador de baja.",
    docs: "https://docs.aws.amazon.com/ses/latest/dg/send-personalized-email-advanced.html",
  },
  {
    id: "postmark",
    name: "Postmark (Mustachio)",
    defaultName: same,
    variable: (n) => `{{${n}}}`,
    unsubscribe: "{{{ pm:unsubscribe }}}",
    preferences: null,
    webversion: null,
    ifStart: (n) => `{{#${n}}}`,
    ifElse: null,
    ifEnd: "{{/__NAME__}}",
    notes: "Mustachio no admite valor por defecto en línea; envíe siempre el campo.",
    docs: "https://postmarkapp.com/support/article/1077-template-syntax",
  },
  {
    id: "mailjet",
    name: "Mailjet",
    defaultName: same,
    variable: (n, f) => (f ? `{{var:${n}:"${q(f)}"}}` : `{{var:${n}}}`),
    unsubscribe: "[[UNSUB_LINK_ES]]",
    preferences: null,
    webversion: "[[PERMALINK]]",
    ifStart: (n) => `{% if var:${n} %}`,
    ifElse: "{% else %}",
    ifEnd: "{% endif %}",
    notes: "Para propiedades de contacto use data:campo en lugar de var:campo.",
    docs: "https://dev.mailjet.com/email/template-language/",
  },
  {
    id: "klaviyo",
    name: "Klaviyo",
    defaultName: same,
    variable: (n, f) =>
      f ? `{{ person.${n}|default:'${f.replace(/'/g, "\\'")}' }}` : `{{ person.${n} }}`,
    unsubscribe: "{% unsubscribe_url %}",
    preferences: "{% manage_preferences_url %}",
    webversion: "{% web_view_url %}",
    ifStart: (n) => `{% if person.${n} %}`,
    ifElse: "{% else %}",
    ifEnd: "{% endif %}",
    notes: "Propiedades estándar: first_name, last_name, email, organization.",
    docs: "https://help.klaviyo.com/hc/en-us/articles/115005084927",
  },
  {
    id: "activecampaign",
    name: "ActiveCampaign",
    defaultName: upper,
    variable: (n) => `%${n}%`,
    unsubscribe: "%UNSUBSCRIBELINK%",
    preferences: "%UPDATELINK%",
    webversion: "%WEBCOPY%",
    ifStart: null,
    ifElse: null,
    ifEnd: null,
    notes:
      "Los condicionales se hacen con contenido condicional del editor de ActiveCampaign.",
    docs: "https://help.activecampaign.com/hc/en-us/articles/220709307",
  },
  {
    id: "sfmc",
    name: "Salesforce Marketing Cloud (AMPscript)",
    defaultName: same,
    variable: (n, f) =>
      f
        ? `%%=IIF(EMPTY(AttributeValue("${n}")),"${q(f)}",AttributeValue("${n}"))=%%`
        : `%%${n}%%`,
    unsubscribe: "%%unsub_center_url%%",
    preferences: "%%profile_center_url%%",
    webversion: "%%view_email_url%%",
    ifStart: (n) => `%%[ IF NOT EMPTY(AttributeValue("${n}")) THEN ]%%`,
    ifElse: "%%[ ELSE ]%%",
    ifEnd: "%%[ ENDIF ]%%",
    notes: "Use los nombres de atributo de su Data Extension o perfil.",
    docs: "https://developer.salesforce.com/docs/marketing/marketing-cloud-ampscript/overview",
  },
  {
    id: "zoho",
    name: "Zoho Campaigns",
    defaultName: upper,
    variable: (n) => `$[LI:${n}]$`,
    unsubscribe: "$[LI:UNSUBSCRIBE]$",
    preferences: "$[LI:UPDATEPROFILE]$",
    webversion: "$[LI:VIEWINBROWSER]$",
    ifStart: null,
    ifElse: null,
    ifEnd: null,
    notes: "Revise los merge tags exactos en Zoho Campaigns > Insertar merge tags.",
    docs: "https://www.zoho.com/campaigns/help/merge-tags.html",
  },
  {
    id: "custom",
    name: "Personalizada (definir patrones)",
    defaultName: same,
    variable: (n) => n,
    unsubscribe: "",
    preferences: null,
    webversion: null,
    ifStart: null,
    ifElse: null,
    ifEnd: null,
    notes: "Defina sus propios patrones en el diálogo de exportación.",
    docs: "",
  },
];

export function getPlatform(
  id: string,
  custom: CustomPlatformConfig = DEFAULT_CUSTOM_PLATFORM,
): Platform {
  if (id === "custom") {
    const tr = (k: string) => (custom.uppercase ? upper(k) : k);
    return {
      ...PLATFORMS.find((p) => p.id === "custom")!,
      defaultName: tr,
      variable: (n, f) =>
        (f && custom.variableWithFallbackPattern
          ? custom.variableWithFallbackPattern
          : custom.variablePattern
        )
          .replaceAll("{name}", n)
          .replaceAll("{fallback}", f),
      unsubscribe: custom.unsubscribe,
      preferences: custom.preferences || null,
      webversion: custom.webversion || null,
      ifStart: custom.ifStart
        ? (n) => custom.ifStart.replaceAll("{name}", n)
        : null,
      ifElse: custom.ifElse || null,
      ifEnd: custom.ifEnd || null,
    };
  }
  return PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[0];
}
