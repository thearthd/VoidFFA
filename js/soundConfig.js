export const SOUND_CONFIG = {
    // Weapon Sounds
    'deagle': {
        'shot': { volume: 0.9, hearingRange: 300, rolloffFactor: 0.4, distanceModel: 'inverse' },
        'reloadStart': { volume: 0.2, hearingRange: 25, rolloffFactor: 0.4, distanceModel: 'inverse' },
        'reloadEnd': { volume: 0.2, hearingRange: 25, rolloffFactor: 0.4, distanceModel: 'inverse' },
        'pull': { volume: 0.2, hearingRange: 25, rolloffFactor: 0.4, distanceModel: 'inverse' }
    },
    'ak-47': {
        'shot': { volume: 0.7, hearingRange: 200, rolloffFactor: 0.4, distanceModel: 'inverse' },
        'reloadStart': { volume: 0.2, hearingRange: 25, rolloffFactor: 0.4, distanceModel: 'inverse' },
        'reloadEnd': { volume: 0.2, hearingRange: 25, rolloffFactor: 0.4, distanceModel: 'inverse' },
        'pull': { volume: 0.2, hearingRange: 25, rolloffFactor: 0.4, distanceModel: 'inverse' }
    },
    'knife': {
        'shot': { volume: 0.2, hearingRange: 20, rolloffFactor: 0.4, distanceModel: 'inverse' },
        'hit': { volume: 0.9, hearingRange: 50, rolloffFactor: 0.4, distanceModel: 'inverse' }, // e.g., hitting another player or surface
        'pull': { volume: 0.2, hearingRange: 25, rolloffFactor: 0.4, distanceModel: 'inverse' }
    },
    'marshal': { // Assuming 'marshal' is a shotgun/rifle type
        'shot': { volume: 1, hearingRange: 500, rolloffFactor: 0.4, distanceModel: 'inverse' },
        'reloadStart': { volume: 0.2, hearingRange: 25, rolloffFactor: 0.4, distanceModel: 'inverse' },
        'reloadEnd': { volume: 0.2, hearingRange: 25, rolloffFactor: 0.4, distanceModel: 'inverser' },
        'pull': { volume: 0.2, hearingRange: 25, rolloffFactor: 0.4, distanceModel: 'inverse' }
    },

    // Physics Sounds (example)
    'footstep': {
        'run': { volume: 0.35, hearingRange: 150, rolloffFactor: 0.4, distanceModel: 'inverse' },
        'walk': { volume: 0.35, hearingRange: 150, rolloffFactor: 0.4, distanceModel: 'inverse' }
    },
    'landingThud': {
        'land': { volume: 0.35, hearingRange: 150, rolloffFactor: 0.4, distanceModel: 'inverse' }
    },
    // Add more general physics sounds as needed, e.g., 'objectImpact', 'glassBreak'
    'objectImpact': {
        'light': { volume: 0.3, hearingRange: 20, rolloffFactor: 0.4, distanceModel: 'linear' },
        'medium': { volume: 0.6, hearingRange: 60, rolloffFactor: 0.4, distanceModel: 'inverse' },
        'heavy': { volume: 0.8, hearingRange: 100, rolloffFactor: 0.4, distanceModel: 'inverse' }
    },
    'glassBreak': {
        'small': { volume: 0.7, hearingRange: 80, rolloffFactor: 0.4, distanceModel: 'inverse' },
        'large': { volume: 1.0, hearingRange: 150, rolloffFactor: 0.4, distanceModel: 'inverse' }
    },

    // Environmental Sounds (example - these might be non-spatial or very far range spatial)
    'wind': {
        'ambient': { volume: 0.3, hearingRange: 500, rolloffFactor: 0.1, distanceModel: 'linear', loop: true }
    },
    'explosion': {
        'default': { volume: 1.0, hearingRange: 500, rolloffFactor: 0.8, distanceModel: 'inverse' }
    }
};
