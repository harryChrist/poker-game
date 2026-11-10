import RummyTable from '../_rummy/RummyTable';
import type { GameViewProps } from '../types';
import type { View, Action } from '@cards/games/cacheta';
import './View.css';

export default function CachetaView(props: GameViewProps<View, Action>) {
  return <RummyTable {...props} prefix="cacheta" />;
}
