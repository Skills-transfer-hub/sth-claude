# Buddy · Claude Code

Buddy suit le contexte et les quotas Claude, les fichiers modifiés et les vérifications, puis aide à retrouver les skills STH adaptés au projet.

## Charger le mod

Claude Code 2.1.287 ou supérieur est requis. Depuis ce dossier :

```sh
claude --plugin-dir .
```

Le module est rechargé à chaque sauvegarde dans une session qui l'a chargé. Une session Desktop sans le plugin ne reçoit pas ces fonctions automatiquement.

## Utilisation

| Accès | Fonction |
| --- | --- |
| Barre au-dessus du prompt ou `/sth-context` | Contexte utilisé, quotas restants, agents actifs ; détail système, tools, MCP, mémoire et messages. |
| `/sth-usage` | Buddy, consommation et boutons pour ouvrir les autres panneaux. |
| Bilan au-dessus du prompt ou `/sth-activity` | Fichiers effectivement écrits, erreurs outils et tests observés. Boutons pour le diff, le brouillon de vérification et le bilan détaillé. Exécution explicite des tests reconnus dans le panneau. |
| `/sth-skills` | Skills installés, versions et mises à jour ; recommandations issues du catalogue selon les manifestes du projet. |
| `/sth-doctor` | Stack, binaires disponibles, commandes de test, configuration STH et état des outils MCP observés. Le diagnostic n'exécute pas les tests. |
| Proposition au retour dans le projet ou `/sth-resume` | Objectif, fichiers, vérifications et prochaine étape de la session précédente. Consultation avant ajout explicite au brouillon ; le résumé n'est pas envoyé automatiquement. |

Buddy distingue le travail en cours, l'attente d'une autorisation, les erreurs, la fin du tour et les interruptions. Un tour principal d'au moins 60 secondes déclenche une notification discrète dans Claude.

Buddy tente d'afficher les PNG d'origine lorsque le terminal accepte les images : 384 × 384 pour les états habituels, 720 × 720 pour Fika. Le refus réel du terminal active un rendu par quadrants colorés, calculé depuis des poses de 96 × 96 pixels. Ce rendu reste un dessin par caractères : son détail dépend de la taille du panneau et de la police du terminal. Sous tmux, il est utilisé directement. Le panneau adapte l'animation à sa taille et propose de l'agrandir lorsqu'il manque de place. Le rendu Desktop garde les images HD existantes.

Le contexte est estimé localement avec le mode `summary` de Claude. Le mod n'appelle pas de modèle supplémentaire pour son suivi. Une mesure inconnue reste indisponible ; les tokens facturés cumulés ne représentent pas le remplissage du contexte.

Les tests sont marqués réussis ou échoués seulement avec un code de sortie observé. Dans les versions où l'outil Bash ne fournit pas ce code, le résultat reste non vérifié. Le bouton d'exécution utilise une commande reconnue du projet et affiche son résultat réel. Le diff natif peut inclure des changements antérieurs au tour.

Les états MCP reflètent les outils exposés et les appels observés. Ils ne prouvent pas qu'un serveur sans outils est connecté. Les versions des skills sont affichées lorsqu'elles sont communiquées par STH. La mise à jour ignore les versions épinglées et protège les modifications locales. Son bilan repose sur une nouvelle lecture de l'état STH ; une vérification échouée reste affichée comme telle.

Le résumé local se trouve dans `.sth/buddy-session.json` dans le dossier de la session. Il contient un objectif abrégé, jusqu'à 40 chemins et 12 résultats de vérification, sans transcript ni sorties de commandes. Les secrets courants sont masqués et les chemins sensibles exclus. Une erreur d'écriture apparaît dans le panneau.

## Installer STH

Si le binaire STH manque, Buddy affiche le guide avant la configuration du projet.

macOS ou Linux avec Homebrew :

```sh
brew install skills-transfer-hub/sth/sth
sth version
```

Windows avec Scoop :

```powershell
scoop bucket add sth https://github.com/Skills-transfer-hub/scoop-sth
scoop install sth
sth version
```

Alternatives Windows : `winget install STH.STH` ou `choco install sth`.

Sans gestionnaire de paquets, utiliser les [releases officielles](https://github.com/Skills-transfer-hub/sth-releases/releases), vérifier `SHA256SUMS` et ajouter le binaire au PATH. Voir la [documentation d'installation STH](https://github.com/Skills-transfer-hub/sth-releases/blob/main/README.md).

Relancer le terminal si nécessaire, puis utiliser « Vérifier l'installation » ou `/sth-doctor`. Une fois STH disponible, `/sth-skills` permet de relier un catalogue au projet.

## Vérifier le mod

```sh
claude plugin validate .
claude plugin test .
```

Les tests couvrent le terminal et le desktop, les boutons et brouillons, les données absentes, les permissions, les bilans et la reprise, ainsi que les animations Buddy/Fika existantes.
