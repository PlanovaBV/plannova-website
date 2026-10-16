# PlanNova website

Statische website van PlanNova B.V. Geen build-stap: `index.html` is de complete pagina.

- `index.html`: pagina met alle CSS en JavaScript
- `assets/`: logo's, favicons, deelafbeelding (og-image.jpg) en lettertypes (zelf gehost)

Live via Netlify: elke wijziging op `main` wordt automatisch gepubliceerd.

Domein: www.planovabv.nl (geregistreerd bij Mijndomein). E-mail draait via Microsoft 365: MX-, SPF- en autodiscover-records bij Mijndomein nooit aanpassen voor de website.

## Portaal (/portaal)

Afgeschermd deel voor Bram en Tom, inloggen met Microsoft 365 (Entra ID).

- `netlify/edge-functions/portaal-auth.ts`: controleert het Microsoft-token (RS256-handtekening, issuer, audience, tenant, nonce, vervaldatum) en laat alleen de accounts in `ALLOWED` toe.
- `portaal/index.html`: de portaalpagina; `{{VOORNAAM}}`, `{{NAAM}}` en `{{EMAIL}}` worden door de edge function ingevuld.
- Geen wachtwoorden of geheime sleutels in de code. Tenant-ID en client-ID zijn openbare kenmerken.
- Iemand toegang geven: zowel in Entra (Enterprise apps > PlanNova portaal > Users and groups) als in `ALLOWED`.
