import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useContainerData } from '../../lib/containers/hooks';
import { useAuth } from '../../hooks/useAuth';
import { useDocumentTitle } from '../../lib/useDocumentTitle';
import { PageState } from '../../components/containers/PageState';
import { RoomBar } from '../../components/containers/RoomParts';
import MockRun from '../../components/containers/MockRun';
import * as copy from '../../components/containers/copy';
import '../../components/containers/room.css';

/**
 * /exams/c/:id/mock?s=<subject>&n=40&t=40 — «Как на экзамене», a room (Layout isRoomPath): the setup when the address
 * names no size, else the timed try; a try in progress on this device is picked up where it stopped (decision 36).
 */
export default function MockPage() {
  const { id = '' } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const state = useContainerData(id);
  const { user } = useAuth();
  useDocumentTitle(copy.MOCK_TITLE);

  if (!state.data) {
    return (
      <div className="ct-roomshell">
        <RoomBar long="" short="" exitLabel={copy.END_EXIT} onExit={() => navigate(`/exams/c/${id}`)} />
        <PageState state={state} loadingText={copy.MOCK_LOADING} />
      </div>
    );
  }
  return (
    <div className="ct-roomshell">
      <MockRun
        key={location.key}
        containerId={id}
        userId={user?.id ?? null}
        summary={state.data.summary}
        items={state.data.items}
        input={state.data.planInput}
        tz={state.data.planInput.tz}
        offline={state.offline}
      />
    </div>
  );
}
