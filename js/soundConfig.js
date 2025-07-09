export const SOUND_CONFIG = {
    // Weapon Sounds
    'deagle': {
        'shot': { volume: 0.9, hearingRange: 300, rolloffFactor: 1, distanceModel: 'inverse' },
        'reloadStart': { volume: 0.2, hearingRange: 25, rolloffFactor: 2, distanceModel: 'inverse' },
        'reloadEnd': { volume: 0.2, hearingRange: 25, rolloffFactor: 2, distanceModel: 'inverse' },
        'pull': { volume: 0.2, hearingRange: 25, rolloffFactor: 2, distanceModel: 'inverse' }
    },
    'ak-47': {
        'shot': { volume: 0.7, hearingRange: 200, rolloffFactor: 1.5, distanceModel: 'inverse' },
        'reloadStart': { volume: 0.2, hearingRange: 25, rolloffFactor: 2, distanceModel: 'inverse' },
        'reloadEnd': { volume: 0.2, hearingRange: 25, rolloffFactor: 2, distanceModel: 'inverse' },
        'pull': { volume: 0.2, hearingRange: 25, rolloffFactor: 2, distanceModel: 'inverse' }
    },
    'knife': {
        'shot': { volume: 0.2, hearingRange: 20, rolloffFactor: 2, distanceModel: 'inverse' },
        'hit': { volume: 0.9, hearingRange: 50, rolloffFactor: 1.8, distanceModel: 'inverse' }, // e.g., hitting another player or surface
        'pull': { volume: 0.2, hearingRange: 25, rolloffFactor: 2, distanceModel: 'inverse' }
    },
    'marshal': { // Assuming 'marshal' is a shotgun/rifle type
        'shot': { volume: 1, hearingRange: 500, rolloffFactor: 0.6, distanceModel: 'inverse' },
        'reloadStart': { volume: 0.2, hearingRange: 25, rolloffFactor: 2, distanceModel: 'inverse' },
        'reloadEnd': { volume: 0.2, hearingRange: 25, rolloffFactor: 2, distanceModel: 'inverser' },
        'pull': { volume: 0.2, hearingRange: 25, rolloffFactor: 2, distanceModel: 'inverse' }
    },

    // Physics Sounds (example)
    'footstep': {
        'run': { volume: 0.35, hearingRange: 150, rolloffFactor: 1.0, distanceModel: 'inverse' },
        'walk': { volume: 0.35, hearingRange: 150, rolloffFactor: 1.0, distanceModel: 'inverse' }
    },
    'landingThud': {
        'land': { volume: 0.35, hearingRange: 150, rolloffFactor: 1.4, distanceModel: 'inverse' }
    },
    // Add more general physics sounds as needed, e.g., 'objectImpact', 'glassBreak'
    'objectImpact': {
        'light': { volume: 0.3, hearingRange: 20, rolloffFactor: 2, distanceModel: 'linear' },
        'medium': { volume: 0.6, hearingRange: 60, rolloffFactor: 1.5, distanceModel: 'inverse' },
        'heavy': { volume: 0.8, hearingRange: 100, rolloffFactor: 1.2, distanceModel: 'inverse' }
    },
    'glassBreak': {
        'small': { volume: 0.7, hearingRange: 80, rolloffFactor: 1.5, distanceModel: 'inverse' },
        'large': { volume: 1.0, hearingRange: 150, rolloffFactor: 1.2, distanceModel: 'inverse' }
    },

    // Environmental Sounds (example - these might be non-spatial or very far range spatial)
    'wind': {
        'ambient': { volume: 0.3, hearingRange: 500, rolloffFactor: 0.1, distanceModel: 'linear', loop: true }
    },
    'explosion': {
        'default': { volume: 1.0, hearingRange: 500, rolloffFactor: 0.8, distanceModel: 'inverse' }
    }
};
