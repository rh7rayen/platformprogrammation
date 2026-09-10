# Versions et sources vérifiées

Vérification effectuée le 9 septembre 2026 par consultation des documentations officielles et de `npm view`, puis installation effective et compilation.

| Composant | Version directe |
|---|---|
| Node.js | 24.18.0 |
| npm de l’environnement | 11.16.0 |
| Next.js | 16.3.4 |
| React / React DOM | 19.3.0 |
| NestJS core/common/platform-express | 11.2.3 |
| Supabase JavaScript | 2.116.0 |
| TypeScript | 5.9.3 |
| Tailwind / PostCSS Tailwind | 4.3.3 |
| PGlite | 0.5.8 |
| PostgreSQL client `pg` | 8.16.3 |
| Playwright | 1.63.0 |
| Zod | 4.1.12 |
| Multer (override de sécurité) | 2.3.0 |
| Monaco Editor | 0.56.0 |
| @monaco-editor/react | 4.7.0 |
| DOMPurify corrigé utilisé pour reconstruire Monaco | 3.4.15 |
| esbuild du constructeur Monaco | 0.28.2 |

Le lockfile fixe les versions transitives. NestJS 11 est conservé comme majeure cohérente validée par le build ; aucune mise à niveau automatique de majeure. Le modèle IA initial est configurable, son accès n’a pas été testé avec un compte externe. Le tag Docker est explicite, mais n’a pas été tiré ni compilé localement faute de Docker.

- [Installation Next.js](https://nextjs.org/docs/app/getting-started/installation) : exigences d’exécution et installation.
- [Migration NestJS](https://docs.nestjs.com/migration-guide) : compatibilité des versions majeures ; la version 11 reste celle choisie dans ce dépôt.
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) : politiques et frontières d’accès.
- [Supabase `getUser`](https://supabase.com/docs/reference/javascript/auth-getuser) : validation de l’identité côté fournisseur.
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) : format JSON contraint et traitement des sorties.
- [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini) : modèle de départ, à valider avec le compte de l’établissement.

L’ajout initial de Monaco avait introduit deux entrées d’audit liées à DOMPurify 3.4.8, également embarqué dans ses sources et son bundle. La refonte du 10 septembre 2026 a épinglé et dédupliqué DOMPurify 3.4.15, reconstruit Monaco depuis ESM avec remplacement explicite de l’import embarqué et retiré les anciens assets AMD. Le dernier `npm audit --audit-level=low` ne signale aucune vulnérabilité. Un manifeste SHA256 et une vérification Chrome portent sur les assets produits. Voir `SECURITY_REVIEW.md` et l’[avis officiel DOMPurify](https://github.com/cure53/DOMPurify/security/advisories/GHSA-55q2-fjhq-7xh7).

- [Monaco Editor, dépôt Microsoft](https://github.com/microsoft/monaco-editor) : éditeur et intégration locale.
- [Monaco React](https://github.com/suren-atoyan/monaco-react) : configuration du loader et cycle de vie de l’éditeur.
