import { useState } from 'react';
import {
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  launchCamera,
  launchImageLibrary,
  type ImagePickerResponse,
} from 'react-native-image-picker';
import { POC_QUESTIONS } from '@corecheck/shared';
import { type CheckView, missingMandatory } from '../model';
import { Banner, Button, styles } from '../ui';

export interface CheckActions {
  answer: (questionKey: 'condition' | 'notes', value: string) => void;
  addPhoto: (uri: string) => void;
  submit: () => void;
  back: () => void;
}

const PICKER_OPTIONS = {
  mediaType: 'photo' as const,
  maxWidth: 1600,
  maxHeight: 1600,
  quality: 0.8 as const,
  // No location or other metadata leaves the device (EVD-004, MOB-009).
  includeExtra: false,
};

/** One check, answered offline or online; every change is saved immediately. */
export function CheckScreen({
  view,
  actions,
}: {
  view: CheckView;
  actions: CheckActions;
}) {
  const [notes, setNotes] = useState(view.answers.notes ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const locked = view.check.status === 'submitted' || view.submitQueued;

  const takePhoto = async (fromLibrary: boolean) => {
    const result: ImagePickerResponse = fromLibrary
      ? await launchImageLibrary(PICKER_OPTIONS)
      : await launchCamera({ ...PICKER_OPTIONS, saveToPhotos: false });
    const uri = result.assets?.[0]?.uri;
    if (uri) actions.addPhoto(uri);
    else if (result.errorMessage) setProblem(result.errorMessage);
  };

  const submit = () => {
    const missing = missingMandatory(view);
    if (missing.length > 0)
      return setProblem(`Answer before submitting: ${missing.join(', ')}.`);
    setProblem(null);
    actions.submit();
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, styles.topContent]}
    >
      <Pressable accessibilityRole="button" onPress={actions.back}>
        <Text style={styles.link}>‹ All checks</Text>
      </Pressable>
      <Text style={styles.title}>{view.check.plantLabel}</Text>
      <Text style={styles.dimmed}>
        {view.check.title} · {view.check.site.name}
      </Text>

      {view.rejection && (
        <Banner tone="danger">{view.rejection.message}</Banner>
      )}
      {view.check.status === 'submitted' && (
        <Banner tone="info">
          Submitted by {view.check.submittedBy?.name}
          {view.check.submittedAt
            ? ` on ${new Date(view.check.submittedAt).toLocaleString()}`
            : ''}
          . It can no longer be changed.
        </Banner>
      )}
      {view.submitQueued && view.check.status !== 'submitted' && (
        <Banner tone="warning">
          Submitted on this device. It will reach CoreCheck when you are back
          online.
        </Banner>
      )}
      {problem && <Banner tone="danger">{problem}</Banner>}

      {POC_QUESTIONS.map((question) => (
        <View key={question.key} style={styles.card}>
          <Text style={styles.label}>
            {question.label}
            {question.mandatory ? ' *' : ''}
          </Text>
          {question.type === 'pass_fail' && (
            <View style={styles.row}>
              {(['pass', 'fail'] as const).map((value) => (
                <View key={value} style={styles.flex1}>
                  <Button
                    title={value === 'pass' ? 'Pass' : 'Fail'}
                    variant={
                      view.answers.condition === value
                        ? value === 'fail'
                          ? 'danger'
                          : 'primary'
                        : 'secondary'
                    }
                    onPress={() => actions.answer('condition', value)}
                    disabled={locked}
                  />
                </View>
              ))}
            </View>
          )}
          {question.type === 'text' && (
            <TextInput
              accessibilityLabel={question.label}
              style={[styles.input, styles.notes]}
              multiline
              editable={!locked}
              value={notes}
              onChangeText={setNotes}
              onEndEditing={() =>
                notes !== (view.answers.notes ?? '') &&
                actions.answer('notes', notes)
              }
            />
          )}
          {question.type === 'photo' && (
            <View style={styles.gap10}>
              <View style={styles.rowWrap}>
                {view.photos.map((photo) => (
                  <Image
                    key={photo.id}
                    source={{ uri: photo.uri }}
                    style={styles.thumbnail}
                    accessibilityLabel="Captured photo"
                  />
                ))}
              </View>
              {view.hasServerPhoto && view.photos.length === 0 && (
                <Text style={styles.dimmed}>A photo is already on record.</Text>
              )}
              {!locked && (
                <View style={styles.row}>
                  <View style={styles.flex1}>
                    <Button
                      title="Take photo"
                      onPress={() => takePhoto(false)}
                      variant="secondary"
                    />
                  </View>
                  <View style={styles.flex1}>
                    <Button
                      title="Choose photo"
                      onPress={() => takePhoto(true)}
                      variant="secondary"
                    />
                  </View>
                </View>
              )}
            </View>
          )}
        </View>
      ))}

      {!locked && <Button title="Submit check" onPress={submit} />}
    </ScrollView>
  );
}
