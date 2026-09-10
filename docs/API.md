# Contrats API — 0.1.0

API NestJS : `/api/v1`. Le navigateur emploie le proxy Next.js `/api`, sur la même origine. Identifiants UUID ; horodatages UTC ; données JSON. Le nom de ressource universitaire est validé contre le registre `packages/contracts/src/index.ts`.

Le proxy place le jeton dans un cookie `HttpOnly`, `SameSite=Strict`, `Secure` en production, nommé `__Host-uniexam_session` en production. Il ne le retourne pas au JavaScript du navigateur. Les méthodes d’écriture exigent une origine exacte. Les réponses privées portent `Cache-Control: no-store`. L’API vérifie la session à chaque accès et attribue un identifiant de requête.

## Authentification

| Méthode et chemin | Entrée | Permission | Réponse |
|---|---|---|---|
| GET `/health/live` | — | Public | `{status, version}` |
| GET `/health/ready` | — | Public | `{status}` ; vérifie la base et la migration |
| GET `/auth/config` | — | Public | `{mode, accounts, self_registration:false}` ; comptes fictifs uniquement en démo |
| POST `/auth/demo` | `{user_id:uuid}` | Mode démo local uniquement | Jeton serveur ; proxy renvoie `{authenticated:true}` |
| POST `/auth/login` | `{email,password}` | Mode Supabase | Identité vérifiée chez Supabase, session applicative enregistrée |
| GET `/auth/me` | Bearer serveur | Session active | `{mode,user,universities,assignments}` |
| POST `/auth/logout` | Bearer serveur | Session active | `{revoked:true}` ; empreinte révoquée durablement |

La session dure au maximum une heure ; il n’existe pas encore de rafraîchissement silencieux. Les refresh tokens du fournisseur ne sont ni retournés ni conservés. Les comptes Supabase non provisionnés dans `profiles` n’accèdent pas à l’application. La révocation applicative est immédiate ; l’API de déconnexion Supabase est appelée au mieux. La Data API Supabase ne dispose pas des droits métier permettant de contourner cette révocation.

## Périmètre universitaire

Préfixe des chemins suivants : `/universities/{universityId}`. Tous exigent une session, une université active et une adhésion active. La présence d’un UUID dans l’URL ne prouve jamais l’autorisation.

| Méthode et chemin | Schéma | Permission serveur | Idempotence/limites |
|---|---|---|---|
| GET `/dashboard` | Compteurs, matières, classes visibles | RLS par ressource | Lecture ; aucun compteur d’examens fictif |
| GET `/academic-structure/{resource}` | `?page=1&search=...` | RLS | 50 lignes/page ; recherche littérale, 120 caractères |
| POST `/academic-structure/{resource}` | Schéma strict du registre | Admin ou responsable dans son périmètre | Création ; code unique → 409 sur doublon |
| GET `/users` | `{data:[{id,full_name,email,status,roles}]}` | Soi-même ou personnel autorisé | 100 comptes maximum ; pagination avancée à ajouter |
| POST `/memberships` | `{user_id,role,department_id?,class_id?,course_offering_id?}` | Admin de l’université | Transaction atomique ; doublon sans création renvoie `created:false` |
| PATCH `/users/{userId}/status` | `{status:ACTIVE\|SUSPENDED}` | Admin, hors propre compte | Répéter applique le même état, audit de chaque écriture |
| GET/POST `/teaching-assignments` | POST `{teacher_id,course_offering_id}` | Lecture par affectation ; écriture par admin/responsable | Relation unique ; vrai rôle TEACHER requis |
| GET/POST `/enrollments` | POST `{student_id,class_id,group_id?}` | Lecture personnelle/personnel ; écriture admin/responsable/scolarité | Inscription active unique ; STUDENT requis |
| GET `/audit` | `{data:[audit]}` | Admin uniquement | 100 événements les plus récents |
| GET `/ai/status` | `{available,daily_limit,human_review_required}` | Membre actif | Aucune clé retournée |
| GET `/ai/drafts` | `{data:[draft]}` | Auteur encore autorisé | 50 brouillons maximum ; aucun brouillon d’autrui |
| POST `/ai/drafts` | `{subject_id,topic,count,difficulty}` | Préparation pédagogique autorisée pour la matière | 1–5 questions, 1 500 caractères, quota journalier ; pas d’auto-publication |

Ressources livrées : `institutions`, `departments`, `programs`, `specialties`, `academic_levels`, `academic_years`, `semesters`, `classes`, `groups`, `subjects`, `course_offerings`.

Exemple de création de matière (les UUID doivent être obtenus via les lectures autorisées) :

```json
{
  "name": "Algorithmique Python",
  "code": "PY-202",
  "department_id": "30000000-0000-4000-8000-000000000001",
  "description": "Boucles, fonctions et structures de données",
  "coefficient": 3,
  "color": "mint"
}
```

Les schémas Zod sont la référence exécutable. Champs supplémentaires refusés, noms bornés, dates ISO, enums explicites. Les contraintes SQL vérifient aussi les relations entre universités, départements, années et groupes. Les réponses étudiantes ne comprennent aucun corrigé IA car la table de brouillons est inaccessible à leurs comptes.

## Erreurs

| Code | Signification |
|---|---|
| 400 | Schéma invalide, relation incohérente, semestre hors année ou rôle supérieur interdit |
| 401 | Absence de session, faux jeton, expiration ou révocation |
| 403 | Université, rôle ou ressource non autorisée ; origine refusée par le proxy |
| 404 | Route absente, mode d’authentification indisponible |
| 408 | Délai de lecture du corps dépassé dans le BFF |
| 409 | Unicité violée, version concurrente, tâche déjà en cours ou segment incohérent |
| 410 | Tentative terminée, segment ou session expiré |
| 413 | Corps du proxy trop volumineux |
| 429 | Limiteur de fréquence ou quota IA atteint |
| 502 | Fournisseur IA en erreur, refus ou format incorrect |
| 503 | Dépendance absente, timeout ou IA non configurée |
| 500 | Erreur interne masquée, sans SQL/secret dans la réponse |

Un échec IA ne fabrique pas de résultat. La réservation du quota est atomique ; une requête fournisseur échouée compte pour éviter un retry infini. Un brouillon n’est stocké qu’après validation complète du format et du nombre demandé. Le limiteur réseau est en mémoire et doit être remplacé/complété par un composant partagé avant montée en charge.

## Devoirs et copies

Routes implémentées sous `/universities/{universityId}` :

| Méthode / chemin | Accès et comportement |
|---|---|
| GET/POST `/assessments` | Liste selon RLS ; création par enseignant affecté |
| GET/PUT `/assessments/{id}` | Détail enseignant ; modification d’un brouillon |
| POST `/assessments/{id}/publish` | Publication immuable, inscrits figés, codes retournés une fois |
| POST `/assessment-access/redeem` | `{code}` ; compte destinataire et code valide |
| POST `/assessments/{id}/attempts` | Début/reprise idempotente avec échéance serveur |
| GET `/attempts/{id}` | Propre tentative, questions, brouillons, heure serveur ; résultats après publication |
| PUT `/attempts/{id}/answers/{questionId}` | `{answer_text,expected_version}` ; 409 conflit, 410 après fermeture |
| POST `/attempts/{id}/finalize` | Remise atomique idempotente |
| POST `/attempts/{id}/questions/{questionId}/runs` | `{expected_version,stdin}` ; propriétaire, runtime imposé et dernière version ; file si runner prêt, sinon 503 |
| GET `/assessments/{id}/submissions` | Copies remises, enseignant affecté uniquement |
| GET `/assessments/{id}/submissions/{submissionId}` | Réponses immuables et notes pour correction |
| POST `/assessments/{id}/submissions/{submissionId}/grades` | `{question_id,score,feedback,expected_version}` ; barème contrôlé et historique |
| POST `/assessments/{id}/results/publish` | Après fermeture et correction complète ; résultats verrouillés |

Schémas stricts dans `packages/contracts/src/assessments.ts` et `runtimes.ts`, limites dans `EXAMS_IMPLEMENTED.md`. Les services externes restent désactivés sans configuration et n’ont pas été validés sur un cloud réel.

La remise et la finalisation sont idempotentes par tentative unique et verrou transactionnel. Les invitations utilisent une clé d’idempotence par job ; les segments réutilisent une réservation unique `(session,sequence)` sans écrasement d’objet. Aucun WebSocket ni flux de surveillance en direct n’est fourni.

## Runtimes, invitations, vidéo et similarité

Les routes suivantes sont également sous `/universities/{universityId}` et exigent une session valide :

| Méthode / chemin | Accès et comportement |
| --- | --- |
| GET `/execution/runtimes` | Catalogue des 14 profils et disponibilité vérifiée ; aucun secret fournisseur. |
| GET `/attempts/{id}/runs/{runId}` | Propre tentative ; statut et sorties bornées, sans source transitoire ni token fournisseur. |
| GET `/assessments/{id}/recipients` | Enseignant affecté ; destinataires et état email, droits de réémission. |
| POST `/assessments/{id}/invitations` | `{emails,retry_failed?}` ; 1–100 adresses de destinataires actifs, file chiffrée. Réémission explicite après FAILED/EXPIRED, avant début/fermeture, au plus 3 sur 24 h. |
| GET `/attempts/{id}/recording` | Propre tentative ; disponibilité Storage, limites et métadonnées de ses sessions. |
| POST `/attempts/{id}/recording/sessions` | `{consented:true,consent_version:"screen-v1"}` ; tentative active et bucket privé prêt. |
| POST `/attempts/{id}/recording/sessions/{sessionId}/chunks` | `{sequence,size_bytes,mime_type}` ; réservation autorisée, quota et URL signée d’upload direct. |
| POST `/attempts/{id}/recording/sessions/{sessionId}/chunks/{chunkId}/complete` | Confirmation après vérification de la taille/MIME réels dans Storage. |
| POST `/attempts/{id}/recording/sessions/{sessionId}/stop` | Arrêt idempotent de sa session. |
| GET `/attempts/{id}/recordings` | Enseignant affecté seulement ; sessions et segments de la copie. |
| GET `/attempts/{id}/recordings/{chunkId}/play` | Enseignant affecté ; URL de lecture de 120 s, refus après expiration. |
| POST `/assessments/{id}/integrity` | Enseignant affecté ; comparaison lexicale locale bornée des copies remises, aucune sanction ni probabilité d’IA. |

Les octets vidéo ne transitent pas dans ces routes JSON ; seul le stockage objet reçoit les uploads. La simulation de fournisseurs dans les tests valide les contrats et autorisations, sans prouver un envoi, une capture cloud ou une compilation réelle. Voir `CLOUD_ACTIVATION.md`.
