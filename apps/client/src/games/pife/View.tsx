import RummyTable from '../_rummy/RummyTable';
import type { GameViewProps } from '../types';
import type { View, Action } from '@cards/games/pife';
import './View.css';

export default function PifeView(props: GameViewProps<View, Action>) {
  return <RummyTable {...props} prefix="pife" />;
}
