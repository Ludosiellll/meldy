/**
 * The phone in a battle without movement rounds: the battle's own screens as they are (`children`), and the room's
 * socket from the join to the end, so the player's character stands round the boss on the 3D projector (BattleHost).
 * Nothing 3D is loaded here; without the socket the projector draws the player from the database all the same.
 */
import { useEffect, useState, type ReactNode } from 'react';
import type { PlayerController, PlayerSnapshot } from '../../player/controller';
import { StandSession } from './session';

export interface BattleLinkProps {
  ctl: PlayerController;
  s: PlayerSnapshot;
  children: ReactNode;
}

export default function BattleLink({ ctl, s, children }: BattleLinkProps) {
  const game = s.game!;
  const [session] = useState(() => new StandSession({ game: game.id, token: ctl.playerToken() ?? '' }));
  useEffect(() => {
    session.connect();
    return () => session.dispose();
  }, [session]);
  return <>{children}</>;
}
