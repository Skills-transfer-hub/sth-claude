# STH · Claude Code

Un mod Claude Code avec **Buddy**, la mascotte STH, pour suivre la consommation de la session et gérer les skills Skills Transfer Hub.

> **Limite actuelle du terminal : 24 × 24 pixels.** Buddy utilise un `Raster` de 24 colonnes × 12 lignes en demi-blocs colorés. Ce rendu apparaît pixelisé, notamment dans le terminal intégré de Claude. La branche desktop utilise des poses **384 × 384 px**, affichées en **144 × 144 px**.

## Installation

Claude Code CLI **2.1.287 ou supérieur** est requis. Le CLI `sth`, configuré et accessible dans le `PATH`, est nécessaire pour les opérations sur les skills.

```sh
git clone https://github.com/Skills-transfer-hub/sth-claude.git
cd sth-claude
claude --plugin-dir ./mods/sth-usage
```

Dans Claude :

- `/sth-usage` ouvre **Buddy · Consommation** : usage réel de la session, tokens, coût et limites disponibles auprès de Claude.
- `/sth-skills` ouvre **Skills STH** : projet lié, catalogue, installation et mises à jour.

Buddy possède six animations à **20 images/s** : prêt, travail, terminé, surveillance, alerte et attente du premier tour.

## La pause Fika

Uniquement dans **Buddy · Consommation**, une bulle de pensée **« Fika ? »** apparaît après **2 minutes avant toute première saisie de prompt**. Activez-la pour jouer la V1 : Buddy, son café, son kanelbulle et sa petite table, pendant **9 secondes à 30 images/s**.

L’animation remplace Buddy, puis revient à son état normal. La première saisie d’un vrai prompt annule la pause et empêche le retour de la bulle, même après effacement. Les commandes du mod permettent d’ouvrir les onglets sans consommer cette surprise.

Pour tester sans attendre :

```sh
STH_FIKA_PREVIEW=1 claude --plugin-dir ./mods/sth-usage
```

Ouvrez `/sth-usage`, attendez **2 secondes**, puis activez **« Fika ? »**. Les poses et les exports WebM/MOV conservent la transparence, avec de légères ombres de contact.

## Vérification

```sh
cd mods/sth-usage
claude plugin validate .
claude plugin test .
```

La dernière suite validée contient **30 tests**, couvrant les deux surfaces, les animations, le replay, le rechargement, l’annulation au premier prompt et le panneau des skills.

## Sources et rendus

- [Modèle Buddy V6](mods/sth-usage/assets/model/buddy-v6.blend).
- [Fika V1 et sources Blender](mods/sth-usage/previews/fika-3d/), avec [exports transparents WebM et ProRes 4444](mods/sth-usage/previews/fika-3d/transparent/).
- [Variante V2 à table pliante](mods/sth-usage/previews/fika-3d/table-v2/), conservée pour exploration et **non intégrée au mod**.
- [Scripts de rendu et d’encodage](mods/sth-usage/tools/README.md).

Les séquences PNG des previews ne sont pas versionnées. Elles peuvent être régénérées avec Blender et les scripts fournis ; les scènes Blender, vidéos et modules d’animation utilisés par le mod sont conservés.
