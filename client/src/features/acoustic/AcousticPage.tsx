import { AcousticView } from "./AcousticView";
import { useAcousticData } from "./useAcousticData";

/** The /acoustic page: connects the screen to the event log. */
export default function AcousticPage() {
  const data = useAcousticData();
  return (
    <AcousticView
      plan={data.plan}
      latestOffset={data.latestOffset}
      sessionOffsets={data.sessionOffsets}
      source={data.source}
      canRecord={data.canRecord}
      record={data.record}
    />
  );
}
