# Matrice des acteurs

Chaque ligne donne **rôle × action × ressource × périmètre**. `I` = IMPLEMENTED dans l’API et testé localement ; `P` = PLANNED. Le déploiement Supabase réel reste à valider. Les permissions sont cumulatives entre les rôles d’une personne, mais un rôle ne vaut que dans son périmètre. L’université et l’adhésion doivent être actives.

| Rôle | Action | Ressource | Périmètre | État |
|---|---|---|---|---|
| Tous les comptes | Se connecter, consulter son profil, se déconnecter | Session/profil | Propre compte | I (démo), PARTIAL (Supabase) |
| Tous les membres | Lire | Établissements, départements, formations, niveaux, années, semestres | Métadonnées de leurs universités actives | I |
| SUPER_ADMIN | Créer, activer, paramétrer | Universités, quotas, runtimes | Plan de contrôle global | P |
| SUPER_ADMIN | Accès pédagogique exceptionnel justifié et limité | Copies, vidéos | Autorisation temporaire auditée | P ; aucun droit implicite |
| UNIVERSITY_ADMIN | Créer et lire | Structure, classes, groupes, matières, enseignements | Son université | I |
| UNIVERSITY_ADMIN | Modifier, archiver | Structure | Son université | P |
| UNIVERSITY_ADMIN | Lire/rattacher des comptes et affecter des rôles universitaires | Adhésions, rôles | Son université ; aucun SUPER_ADMIN | I |
| UNIVERSITY_ADMIN | Suspendre/réactiver | Adhésions | Son université, hors propre compte | I |
| UNIVERSITY_ADMIN | Créer des comptes, inviter, importer CSV | Identités | Son université, invitation contrôlée | P ; bootstrap opérateur PARTIAL |
| UNIVERSITY_ADMIN | Affecter/inscrire | Enseignants, étudiants | Matières/classes de son université | I |
| UNIVERSITY_ADMIN | Lire | Audit administratif | Son université | I |
| UNIVERSITY_ADMIN | Lire automatiquement toutes les copies/vidéos | Données pédagogiques sensibles | Non accordé par le rôle administratif | I : refus vérifié |
| ACADEMIC_MANAGER | Créer/lire | Formations, spécialités, classes, groupes, matières, enseignements | Département affecté ou université si délégation globale | I |
| ACADEMIC_MANAGER | Affecter/inscrire | Enseignants, étudiants | Département autorisé | I |
| ACADEMIC_MANAGER | Attribuer des rôles/suspendre | Identités | Refusé | I |
| ACADEMIC_MANAGER | Valider publication, consulter résultats | Examens, résultats | Délégation pédagogique explicite | P |
| SCHOOL_OFFICE | Lire les classes et listes, inscrire | Classes/inscriptions | Université ou classe autorisée | I |
| SCHOOL_OFFICE | Modifier corrigés, affecter enseignants, attribuer rôles | Pédagogie/identité | Refusé | I pour les actions présentes |
| SCHOOL_OFFICE | Importer, éditer listes et profils | Administration | Périmètre délégué | P |
| TEACHER | Lire | Classes, matières, enseignements | Affectation pédagogique explicite | I |
| TEACHER | Lire noms des étudiants | Profils/inscriptions | Classes enseignées et rôle autorisé | I |
| TEACHER | Préparer des brouillons IA | Questions privées | Matière enseignée ; auteur du brouillon | PARTIAL |
| TEACHER | Créer/modifier brouillon/publier | Questions, devoirs, barèmes, codes | Enseignements affectés | I ; versionnement avancé futur |
| TEACHER | Inviter/réémettre après échec | Codes et emails de devoir | Destinataires actifs affectés, sans tentative démarrée ; quota de réémission | I pour autorisations ; Resend réel à configurer |
| TEACHER | Corriger, publier notes | Copies, notes et commentaires | Enseignements affectés | I ; réclamations futures |
| TEACHER | Lire les enregistrements reçus | Vidéos privées | Enseignant affecté au devoir | I pour autorisations ; Storage réel à valider, aucun flux live |
| TEACHER | Comparer les copies | Similarité lexicale | Copies remises de son devoir | I ; aucun taux d’usage d’IA ni sanction automatique |
| PROCTOR | Lire et signaler | Sessions, flux, incidents | Affectation nominative à une épreuve | P |
| PROCTOR | Modifier notes/corrigés | Résultats/questions | Refusé ; aucune route accordée | P |
| STUDENT | Lire | Matières, classes, enseignements | Inscription active | I |
| STUDENT | Lire | Profil/inscriptions | Propres données uniquement | I |
| STUDENT | Lire les profils d’autres étudiants | Profils | Refusé | I |
| STUDENT | Créer structure, attribuer rôles, générer corrigés IA | Administration/contenu pédagogique | Refusé | I |
| STUDENT | Entrer un code, démarrer, sauvegarder, remettre | Devoir/tentative | Attribution personnelle et compte connecté | I |
| STUDENT | Demander une exécution | Code enregistré | Sa tentative active, runtime fixé par question, version courante | I pour autorisations ; runner réel à configurer, SQL en édition seule |
| STUDENT | Capturer/transférer | Écran choisi et segments | Consentement, sa tentative active, quotas et stockage privé prêt | I pour autorisations ; Storage réel à valider |
| STUDENT | Lire résultat | Notes/commentaires | Propres résultats publiés | I ; réclamations futures |

Les permissions de rôle sont implémentées par des helpers SQL, plutôt que des tables `roles` et `permissions` modifiables sans interface de gouvernance. Les rôles d’université utilisent un enum SQL. Les invitations et sessions d’identité Supabase ne sont pas dupliquées artificiellement dans des tables vides ; seule la session applicative révocable a sa propre table privée.

Le serveur refuse les actions inconnues et les champs supplémentaires. L’interface masque les commandes selon les rôles, mais les contrôles API et SQL restent l’autorité. Les permissions des demandes d’exécution, invitations et vidéos sont testées avec des fournisseurs simulés ; l’isolation du runner réel et Storage doivent encore être validés. WebSockets, exports génériques et surveillance live restent futurs.

Les tests couvrent faux jeton, autre université/classe/étudiant, relations interuniversités, élévation de privilège, responsable hors périmètre, suspension, révocation, permissions de copie, invitations, quotas d’exécution et autorisations vidéo. Une copie remise reste disponible après changement de classe, avec identité masquée lorsque le profil n’est plus visible. Les essais cloud et des hôtes de sandbox réels restent à exécuter.
