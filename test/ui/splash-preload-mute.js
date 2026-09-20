'use strict';

/** Un pont qui ne répond pas : la page doit s'en remettre, pas s'y casser. */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('splash', {
  words: async () => {
    throw new Error('le pont ne répond pas');
  },
  keep: async () => {
    throw new Error('le pont ne répond pas');
  },
  close: async () => {
    throw new Error('le pont ne répond pas');
  },
});
