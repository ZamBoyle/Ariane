'use strict';

/**
 * Le pont de l'écran d'accueil, en double.
 *
 * Il expose exactement les deux fonctions de src/preload/splash.js — et rien
 * d'autre, comme le vrai. Il retient ce qu'on lui demande, pour que la suite
 * puisse vérifier que la case écrit bien le choix.
 */

const { contextBridge } = require('electron');

const calls = [];
const closes = [];

contextBridge.exposeInMainWorld('splash', {
  words: async () => ({ hide: 'Ne plus afficher cet écran au démarrage', dismiss: 'Continuer' }),
  keep: async (on) => {
    calls.push(on);
    return { splash: on };
  },
  close: async () => {
    closes.push(Date.now());
    return { closed: true };
  },
});

contextBridge.exposeInMainWorld('probe', {
  calls: () => calls.slice(),
  closes: () => closes.length,
});
