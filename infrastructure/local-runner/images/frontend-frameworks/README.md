# React et Angular dans le runner isolé

L’image compile des projets pédagogiques de deux fichiers, sans installer de dépendances pendant un devoir. La source est seulement analysée et compilée dans Docker ; l’application JavaScript produite s’exécute dans l’iframe opaque du navigateur.

Versions épinglées : React/React DOM 19.3.0, Angular 22.1.6, TypeScript 6.0.3, esbuild 0.28.2 et Babel 8.0.1. Le lock npm est propre à cette image. La base officielle Node 24/Alpine 3.22 est fixée par digest et le Dockerfile contrôle Node >=24.15. Les bibliothèques React et Angular utilisent la licence MIT ; leurs mentions sont conservées dans le bundle.

Les définitions exportées par `../../react-angular.ts` utilisent un fichier `/work/project.json`, le script fixe `/opt/uniexam/build.mjs`, puis `/opt/uniexam/summary.mjs`. Le premier est une commande de compilation : ses erreurs deviennent `COMPILE_ERROR`. Le second affiche `Bonjour!`, marqueur de succès attendu par le bootstrap commun, et ne prétend pas être la sortie de l’application étudiante. Le vrai résultat est `/tmp/preview.html`.

## Format borné

```json
{"format":"uniexam-project-v1","runtime":"react","files":{"App.tsx":"export default function App() { return <h1>Bonjour!</h1>; }","style.css":"body { font-family: system-ui; }"}}
```

Angular utilise exactement `app.component.ts` et `style.css`, avec un composant standalone exporté sous le nom `AppComponent` et le sélecteur `app-root`. Ses templates restent inline. Le JSON entier est limité à 30 000 octets ; chemins arbitraires, caractères nuls, fichiers supplémentaires, package.json, références externes et imports dynamiques sont refusés. Les imports disponibles sont React/React DOM, ou Angular core/common/forms et RxJS. Aucun `npm install` étudiant, plugin, script de paquet ou commande arbitraire n’est chargé.

React passe par TypeScript puis esbuild. Angular passe par `ngc` AOT avec vérification stricte des templates, puis le linker Babel officiel d’Angular et esbuild. Le bundle final autonome est intégré au HTML avec CSP sans `unsafe-eval`. Les styles et les balises de fin de script sont échappés. Le conteneur n’a aucun réseau, fonctionne sous UID65534, rootfs en lecture seule, 768 Mio de RAM, 128 Mio temporaires et 45 secondes au maximum pour compiler. Le HTML est limité à 2 Mio. Le runner sert l’artefact temporairement par l’API dédiée ; aucun bundle ne va dans la BDD.

## Vérification réelle

Test opt-in depuis la racine du dépôt, après construction de l’image et configuration du chemin Docker :

```powershell
$env:UNIEXAM_FRAMEWORK_LIVE = 'true'
node --import tsx --test infrastructure/local-runner/test/react-angular.live.test.ts
```

Le test utilise seulement des exemples synthétiques et un dossier temporaire propre. Il lance chaque compilation via `DockerEngine`, ouvre le HTML dans Chrome hors réseau, clique le compteur 0 → 1, vérifie que le parent DOM reste inaccessible, puis soumet une erreur TypeScript React et une erreur de template Angular. Passage réel réussi le 10 septembre 2026 : React 223 843 octets et Angular AOT 306 643 octets, erreurs correctement refusées, 25 secondes pour l’ensemble. Cela prouve les outils et l’aperçu ; le parcours BFF/éditeur complet a sa recette séparée.

## Sources officielles

- [Versions React](https://react.dev/versions) et [paquet React 19.3.0](https://registry.npmjs.org/react/19.3.0).
- [Paquet Angular 22.1.6](https://registry.npmjs.org/@angular/core/22.1.6) et [compatibilité Node/TypeScript](https://angular.dev/reference/versions).
- [Options du compilateur Angular et ngc](https://angular.dev/reference/configs/angular-compiler-options).
- [Intégration du linker Angular dans un build personnalisé](https://angular.dev/tools/libraries/creating-libraries).
- [API esbuild](https://esbuild.github.io/api/) et [plugins esbuild](https://esbuild.github.io/plugins/).
