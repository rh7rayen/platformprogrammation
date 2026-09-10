# Comparaison locale des copies de code

L’enseignant affecté déclenche explicitement `POST /universities/:u/assessments/:assessmentId/integrity`. Le service relit les copies **remises**, après vérification du périmètre enseignant et sous politiques RLS. Les étudiants, les enseignants d’une autre matière et les administrateurs sans affectation ne peuvent pas demander ces résultats. Les extraits retournés restent dans le même périmètre de correction. Aucun code n’est envoyé à un LLM ou exécuté.

La méthode tokenise le code en conservant les noms, valeurs et opérateurs et en ignorant espaces et commentaires usuels du langage. Elle forme des séquences de cinq tokens consécutifs, hachées en SHA-256 tronqué à 96 bits. Elle retire les séquences présentes dans le code initial fourni par l’enseignant. Les fichiers du format `uniexam-web-v1` sont extraits et réunis avant ce traitement.

Deux mesures sont affichées pour une même question et un même langage :

- Jaccard : nombre de séquences communes divisé par le nombre total de séquences distinctes des deux réponses.
- Recouvrement : nombre de séquences communes divisé par le nombre de séquences distinctes de la réponse la plus courte.

Une paire est affichée si elle partage au moins douze séquences et atteint 35 % de Jaccard ou 65 % de recouvrement. Ces seuils sont des paramètres de consultation, **pas des seuils de fraude**. L’interface décrit la méthode et fournit deux extraits de 180 caractères au maximum pour permettre une vérification humaine. Elle ne produit pas de « probabilité IA », n’identifie aucun auteur et ne modifie aucune note ni sanction.

## Limites assumées

Des solutions légitimes peuvent se ressembler fortement lorsque l’exercice impose une réponse courte ou standard. Le renommage, le réordonnancement, des macros et d’autres transformations peuvent réduire la similarité de copies pourtant apparentées. La tokenisation générique n’est pas un parseur complet de chaque langage ; chaînes multilignes, commentaires imbriqués et particularités de syntaxe peuvent être traités imparfaitement. Un score bas n’exclut pas une source externe ; un score haut ne la démontre pas. Les résultats servent à préparer une revue pédagogique contextualisée et, si nécessaire, une discussion avec les étudiants.

Les réponses possédant moins de douze séquences restantes après retrait du squelette sont ignorées. L’analyse est limitée aux 3 500 premiers tokens par réponse et signale explicitement les troncatures. Une demande interactive accepte au maximum 200 copies et deux millions de caractères de code au total, vérifiés dans PostgreSQL avant chargement des réponses. Elle retourne les cinquante paires les plus similaires et indique le nombre total de paires au-dessus des seuils. La limite SQL de 6 000 réponses correspond aux 200 copies × 30 questions autorisées par le modèle de devoir.

Ce calcul borné est destiné à la revue interactive de groupes. Pour de gros établissements ou des analyses simultanées, déplacer le calcul dans une file dédiée avec quotas par établissement, workers CPU isolés, annulation et durée maximale. Ne pas augmenter simplement les limites dans le processus API. Tester les taux de faux rapprochements et les performances sur un corpus autorisé représentatif avant tout usage institutionnel ; aucune capacité de détection d’IA n’est revendiquée.

## Validation livrée

Six tests vérifient : égalité malgré espaces/commentaires ; retrait du squelette et réponses courtes ; extraction Web ; borne de tokens et limite de résultats ; permissions réelles sur PostgreSQL/RLS et absence de modification des notes ; rejet du volume avant chargement applicatif. Les exemples sont synthétiques. Ces tests valident le fonctionnement technique, pas une précision de détection de plagiat ou d’usage d’IA dans une population réelle.
