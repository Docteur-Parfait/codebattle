# Contribuer à CodeBattle

Merci de vouloir aider Parfait dans sa quête ! 🎮
Ce guide explique comment proposer une amélioration, du simple signalement de bug à une nouvelle fonctionnalité.

## Sommaire

1. [Code de conduite](#code-de-conduite)
2. [Signaler un bug](#signaler-un-bug)
3. [Proposer une idée](#proposer-une-idée)
4. [Préparer son environnement](#préparer-son-environnement)
5. [Faire une pull request](#faire-une-pull-request)
6. [Conventions de code](#conventions-de-code)
7. [Contribuer aux ressources](#contribuer-aux-ressources-graphismes-sons-niveaux)
8. [Par où commencer ?](#par-où-commencer-)

## Code de conduite

Sois respectueux et bienveillant. Les critiques portent sur le code, jamais sur les personnes.
Le harcèlement, les insultes et les propos discriminatoires ne sont pas tolérés : les contributions concernées seront refusées et leurs auteurs bloqués.

## Signaler un bug

Avant d'ouvrir une *issue*, vérifie qu'elle n'existe pas déjà. Ensuite, indique :

- **ce qui se passe** et **ce que tu attendais** ;
- **comment le reproduire** : niveau, difficulté, actions effectuées ;
- **ton environnement** : navigateur et version, PC ou mobile, clavier ou tactile ;
- une **capture d'écran** ou une courte vidéo si possible ;
- les **erreurs de la console** du navigateur (F12 → Console).

> Astuce : avec `?debug` dans l'URL, `__cb.startLevel(n)` lance directement le niveau `n`, pratique pour reproduire un bug.

## Proposer une idée

Ouvre une *issue* qui décrit l'idée, pourquoi elle améliore le jeu et, si tu peux, comment l'implémenter.
Pour un changement important (nouveau système de jeu, refonte d'un écran), **discutons-en dans l'issue avant de coder** : ça évite de travailler pour rien.

## Préparer son environnement

Prérequis : **Node.js** (pour le serveur de développement) et, seulement si tu touches aux graphismes, **Python 3** avec `pillow`, `numpy` et `scipy`.

```bash
# 1. Forke le dépôt sur GitHub, puis :
git clone https://github.com/<ton-pseudo>/codebattle.git
cd codebattle
git remote add upstream https://github.com/Docteur-Parfait/codebattle.git

# 2. Lance le jeu
node tools/serve.js 8091
# → http://localhost:8091
```

Le projet n'a **aucune dépendance npm** ni étape de compilation : modifie un fichier, recharge la page.

## Faire une pull request

1. Mets ta branche `main` à jour : `git pull upstream main`.
2. Crée une branche au nom explicite : `git checkout -b fix/saut-plateforme` ou `feat/ennemi-ninja`.
3. Fais des commits petits et clairs (voir ci-dessous).
4. **Teste dans le jeu** : au minimum le niveau concerné, au clavier, et en tactile si tu as touché aux commandes (DevTools → mode appareil).
5. Pousse ta branche et ouvre une *pull request* vers `main` en décrivant :
   - ce qui change et pourquoi ;
   - comment tester ;
   - une capture ou une vidéo pour tout changement visible ;
   - l'issue liée (`Closes #12`).

Une PR = un sujet. Plusieurs petites PR sont plus faciles à relire qu'une grosse.

### Messages de commit

Utilise un préfixe court et un message à l'impératif :

```
feat: ajoute le Ninja Glitch au monde 3
fix: Parfait ne peut plus traverser les plateformes hautes
perf: met en cache les bandes de parallaxe
docs: précise les commandes tactiles
assets: nouvelle musique du monde 4
```

## Conventions de code

- **JavaScript moderne en modules ES**, sans framework ni bundler.
- Indentation de **2 espaces**, apostrophes simples `'`, points-virgules.
- Noms en anglais dans le code (`camX`, `spawnBlast`) ; textes affichés au joueur en **français**.
- Les commentaires expliquent le **pourquoi**, pas le quoi.
- Le jeu tourne en **1280×720** : garde les coordonnées dans cet espace, le redimensionnement est géré par `main.js`.
- Le jeu doit rester fluide sur un téléphone Android moyen : évite les allocations dans la boucle `update`/`render`.
- Pas de nouvelle dépendance sans en discuter d'abord dans une issue.

Où intervenir :

| Tu veux… | Fichier |
|---|---|
| changer le comportement de Parfait ou d'un ennemi | `js/entities.js` |
| modifier la génération des niveaux | `js/level.js` |
| ajouter un effet, un projectile, un élément du HUD | `js/game.js` |
| régler la difficulté | `js/difficulty.js` |
| ajouter ou brancher un son | `js/audio.js` |
| changer les noms de niveaux, miniatures, cinématiques | `assets/levels/levels.json` |

## Contribuer aux ressources (graphismes, sons, niveaux)

- **Sprites** : ajoute la planche dans `assets/sprites/`, décris ses lignes dans `SHEETS` de `tools/build_assets.py`, puis lance `python -I tools/build_assets.py`. Ne modifie jamais `assets/build/` à la main : ce dossier est régénéré.
- **Décors** : les rectangles nommés de chaque planche de décor sont définis dans `tools/build_env.py`, qui écrit `assets/build/env.json` (`python -I tools/build_env.py`).
- **Sons** : dépose un `.mp3` dans `assets/audio/` et ajoute son nom à la liste `FILES` de `js/audio.js`. Garde des fichiers courts et légers (128 kbps suffisent).
- **Style** : respecte la direction artistique (illustration façon BD, contours nets, couleurs saturées) et le design existant de Parfait et des ennemis.
- N'envoie que des ressources **que tu as le droit de partager**, et précise leur origine dans la PR. Les ressources du dépôt restent soumises à la [licence décrite dans le README](README.md#licence).

## Par où commencer ?

Quelques pistes accessibles :

- ajouter des traductions (anglais, portugais…) des textes du jeu ;
- améliorer l'accessibilité : remappage des touches, prise en charge de la manette (Gamepad API) ;
- ajouter un nouvel ennemi ou une nouvelle attaque ;
- équilibrer la difficulté de certains niveaux ;
- chercher les issues marquées **`good first issue`**.

Merci pour ton aide ! 🙌
