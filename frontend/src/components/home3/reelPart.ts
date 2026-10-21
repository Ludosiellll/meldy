import { lazyPart } from '../../lib/lazyPart';

/**
 * The reel's file, fetched once the page has loaded (the largest paint is the headline, not the reel). It also carries
 * the game's footage player, the phone's footage and what keeps the two in step for the section «Игра в классе»: one
 * late file for both, and no other split of the page's code (a new lazy file here moved 3.8 KB of unrelated shared code
 * into the app's first file).
 */
export const reelPart = lazyPart(() =>
  import('../reel3/Reel3').then((module) => ({
    Reel: module.default,
    Footage: module.Footage,
    footage: module.GAME_FOOTAGE,
    phone: module.GAME_PHONE_FOOTAGE,
    follow: module.follow,
  })),
);
