import Ionicons from '@expo/vector-icons/Ionicons';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import type { ComponentProps } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { VehiclesScreen } from './src/features/vehicles/VehiclesScreen';
import { useActiveVehicle } from './src/features/vehicles/useActiveVehicle';
import { formatNumber, variantLabel } from './src/features/vehicles/format';
import { colors as c } from './src/theme';

const tabs = [
  { label: 'Rota', icon: 'map-outline' },
  { label: 'Araçlar', icon: 'car-sport-outline' },
  { label: 'İstasyonlar', icon: 'flash-outline' },
] as const satisfies ReadonlyArray<{ label: string; icon: ComponentProps<typeof Ionicons>['name'] }>;
type Tab = (typeof tabs)[number]['label'];

export default function App() {
  return <SafeAreaProvider><ChargeRoad /></SafeAreaProvider>;
}

function ChargeRoad() {
  const [tab, setTab] = useState<Tab>('Rota');
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [startingCharge, setStartingCharge] = useState('');
  const selection = useActiveVehicle();
  const vehicle = selection.vehicle;
  const chargeValid = startingCharge !== '' && /^\d{1,3}$/.test(startingCharge) && Number(startingCharge) <= 100;

  return (
    <SafeAreaView style={s.safeArea} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <View style={s.brandMark}><Ionicons name="flash" size={21} color={c.lime} /></View>
        <View style={s.brandCopy}>
          <Text style={s.wordmark}>charge<Text style={s.wordmarkLight}>road</Text><Text style={s.brandDot}>.</Text></Text>
          <Text style={s.brandCaption}>DAHA UZAĞA, DAHA ÖZGÜR.</Text>
        </View>
        <View style={s.headerBadge}><View style={s.liveDot} /><Text style={s.headerBadgeText}>EV LIFE</Text></View>
      </View>

      <KeyboardAvoidingView style={s.main} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {tab === 'Araçlar' ? (
          <VehiclesScreen activeVehicle={vehicle} onSelect={async (next) => {
            await selection.select(next);
            setTab('Rota');
          }} />
        ) : tab === 'Rota' ? (
          <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={s.eyebrowRow}><View style={s.orangeDot} /><Text style={s.eyebrow}>BİR SONRAKİ YOLCULUĞUN</Text></View>
            <Text style={s.title}>Yeni yollar,{'\n'}aynı özgürlük.</Text>
            <Text style={s.subtitle}>Aracını seç. Yolculuğuna yer aç.</Text>

            <View style={s.routeForm}>
              <View style={s.inputRow}>
                <View style={s.originDot} />
                <View style={s.inputCopy}>
                  <Text style={s.inputLabel}>BAŞLANGIÇ</Text>
                  <TextInput accessibilityLabel="Başlangıç noktası" placeholder="Nereden yola çıkıyoruz?"
                    placeholderTextColor={c.muted} value={origin} onChangeText={setOrigin} style={s.input} />
                </View>
              </View>
              <View style={s.formDivider} />
              <View style={s.inputRow}>
                <Ionicons name="location-outline" size={21} color={c.green} />
                <View style={s.inputCopy}>
                  <Text style={s.inputLabel}>VARIŞ</Text>
                  <TextInput accessibilityLabel="Varış noktası" placeholder="Sıradaki durağın neresi?"
                    placeholderTextColor={c.muted} value={destination} onChangeText={setDestination} style={s.input} />
                </View>
              </View>
            </View>

            <View style={s.sectionRow}>
              <Text style={s.sectionTitle}>Yol arkadaşın</Text>
              {vehicle && <Pressable accessibilityRole="button" onPress={() => setTab('Araçlar')} hitSlop={10}>
                <Text style={s.textAction}>Değiştir ↗</Text>
              </Pressable>}
            </View>

            {selection.loading ? <View style={s.loadingCard}><ActivityIndicator color={c.green} /><Text style={s.loadingText}>Garajın yükleniyor…</Text></View>
              : vehicle ? (
                <Pressable accessibilityRole="button" accessibilityLabel="Seçili aracı değiştir"
                  onPress={() => setTab('Araçlar')} style={({ pressed }) => [s.vehicleCard, pressed && s.pressed]}>
                  <View style={s.vehicleTop}>
                    <View style={s.carIcon}><Ionicons name="car-sport-outline" size={31} color={c.lime} /></View>
                    <View style={s.vehicleCopy}>
                      <Text style={s.vehicleEyebrow}>SEÇİLİ ARACIN</Text>
                      <Text style={s.vehicleTitle}>{vehicle.make} {vehicle.model}</Text>
                      <Text style={s.vehicleSubtitle}>{variantLabel(vehicle)} · {vehicle.modelYear}</Text>
                    </View>
                    <Ionicons name="checkmark-circle" size={23} color={c.lime} />
                  </View>
                  <View style={s.vehicleDivider} />
                  <View style={s.vehicleMetrics}>
                    <View><Text style={s.metricLabel}>KULLANILABİLİR BATARYA</Text><Text style={s.metricValue}>{formatNumber(vehicle.usableBatteryKwh, 'kWh')}</Text></View>
                    <View><Text style={s.metricLabel}>MAKS. DC ŞARJ</Text><Text style={s.metricValue}>{formatNumber(vehicle.maxDcChargeKw, 'kW')}</Text></View>
                  </View>
                </Pressable>
              ) : (
                <View style={s.emptyGarage}>
                  <View style={s.emptyGarageIcon}><Ionicons name="car-sport-outline" size={35} color={c.green} /></View>
                  <Text style={s.emptyGarageTitle}>Her şey aracınla başlar.</Text>
                  <Text style={s.emptyGarageText}>Marka, model ve varyantını seç.{'\n'}Yol arkadaşını garajına ekle.</Text>
                  <Pressable accessibilityRole="button" onPress={() => setTab('Araçlar')}
                    style={({ pressed }) => [s.primaryButton, pressed && s.pressed]}>
                    <Text style={s.primaryButtonText}>Aracını seç</Text><Ionicons name="arrow-forward" size={19} color={c.lime} />
                  </Pressable>
                </View>
              )}

            {selection.error && <View style={s.selectionError}>
              <Text accessibilityRole="alert" style={s.errorText}>{selection.error}</Text>
              <Pressable accessibilityRole="button" onPress={() => void selection.retry()} style={s.retryButton}>
                <Text style={s.textAction}>Tekrar dene</Text>
              </Pressable>
            </View>}

            {vehicle && (
              <View style={s.chargeCard}>
                <View style={s.chargeIcon}><Ionicons name="battery-half-outline" size={22} color={c.green} /></View>
                <View style={s.chargeCopy}><Text style={s.chargeTitle}>Başlangıç şarjın</Text><Text style={s.chargeCaption}>Yola çıkarken bataryan kaçta?</Text></View>
                <View style={[s.chargeInputBox, startingCharge !== '' && !chargeValid && s.invalidInput]}>
                  <Text style={s.percent}>%</Text>
                  <TextInput accessibilityLabel="Başlangıç şarj yüzdesi" keyboardType="number-pad" maxLength={3}
                    placeholder="80" placeholderTextColor="#9AA691" value={startingCharge}
                    onChangeText={setStartingCharge} style={s.chargeInput} />
                </View>
              </View>
            )}
            {vehicle && startingCharge !== '' && !chargeValid
              && <Text accessibilityRole="alert" style={s.errorText}>Şarj seviyesini 0–100 arasında gir.</Text>}

            <View style={s.comingSoon}>
              <View style={s.comingIcon}><Ionicons name="navigate-outline" size={20} color={c.green} /></View>
              <View style={s.comingCopy}><Text style={s.comingTitle}>Yolun devamı yakında.</Text>
                <Text style={s.comingText}>Aracına özel rota ve şarj durakları burada olacak.</Text></View>
            </View>
            <Text style={s.footerWordmark}>DAHA AZ ENDİŞE. DAHA ÇOK YOL.</Text>
          </ScrollView>
        ) : (
          <View style={s.stationEmpty}>
            <View style={s.stationIcon}><Ionicons name="flash-outline" size={44} color={c.green} /></View>
            <Text style={s.stationKicker}>ŞARJ AĞIN</Text>
            <Text style={s.stationTitle}>Bir mola,{'\n'}yeni bir başlangıç.</Text>
            <Text style={s.stationText}>Şarj istasyonları ve güncel müsaitlik bilgileri yakında burada.</Text>
            <View style={s.soonBadge}><Text style={s.soonText}>YAKINDA</Text></View>
          </View>
        )}
      </KeyboardAvoidingView>

      <View style={s.navigation} accessibilityRole="tablist">
        {tabs.map((item) => {
          const active = item.label === tab;
          return (
            <Pressable key={item.label} accessibilityRole="tab" accessibilityState={{ selected: active }}
              onPress={() => setTab(item.label)} style={s.navItem}>
              <View style={[s.navIcon, active && s.navIconActive]}>
                <Ionicons name={item.icon} size={22} color={active ? c.ink : c.muted} />
              </View>
              <Text style={[s.navLabel, active && s.navLabelActive]}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: c.background },
  main: { flex: 1 },
  header: { paddingHorizontal: 22, paddingTop: 10, paddingBottom: 15, flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 37, height: 41, backgroundColor: c.ink, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  brandCopy: { flex: 1 },
  wordmark: { color: c.ink, fontSize: 22, fontWeight: '900', letterSpacing: -1.1 },
  wordmarkLight: { fontWeight: '400' },
  brandDot: { color: c.orange },
  brandCaption: { color: c.muted, fontSize: 7, fontWeight: '700', letterSpacing: 1.1, marginTop: 2 },
  headerBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: c.line, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 20 },
  liveDot: { height: 5, width: 5, borderRadius: 3, backgroundColor: c.green },
  headerBadgeText: { color: c.green, fontSize: 8, fontWeight: '700', letterSpacing: 1 },
  content: { padding: 22, paddingTop: 24, paddingBottom: 30 },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 12 },
  orangeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: c.orange },
  eyebrow: { color: c.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.7 },
  title: { color: c.ink, fontSize: 36, lineHeight: 40, fontWeight: '800', letterSpacing: -1.3 },
  subtitle: { color: c.muted, fontSize: 13, marginTop: 10, marginBottom: 24 },
  routeForm: { backgroundColor: c.surface, borderRadius: 21, borderWidth: 1, borderColor: c.line, paddingHorizontal: 17, paddingVertical: 5 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 69 },
  originDot: { width: 13, height: 13, borderRadius: 7, borderWidth: 3, borderColor: c.green, marginHorizontal: 4 },
  inputCopy: { flex: 1 },
  inputLabel: { color: c.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1.3, marginBottom: 3 },
  input: { color: c.ink, fontSize: 13, paddingVertical: 5 },
  formDivider: { height: 1, marginLeft: 34, backgroundColor: '#EDF0E9' },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 26, marginBottom: 12 },
  sectionTitle: { color: c.ink, fontSize: 16, fontWeight: '700' },
  textAction: { color: c.green, fontSize: 11, fontWeight: '700' },
  loadingCard: { minHeight: 130, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: c.muted, fontSize: 12 },
  vehicleCard: { backgroundColor: c.ink, padding: 19, borderRadius: 22 },
  vehicleTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  carIcon: { width: 49, height: 49, borderRadius: 15, backgroundColor: '#305747', alignItems: 'center', justifyContent: 'center' },
  vehicleCopy: { flex: 1 },
  vehicleEyebrow: { color: '#ADC5B5', fontSize: 8, letterSpacing: 1.2, fontWeight: '700' },
  vehicleTitle: { color: c.surface, fontSize: 17, fontWeight: '700', marginTop: 5 },
  vehicleSubtitle: { color: '#BDD1C3', fontSize: 10, marginTop: 4, lineHeight: 16 },
  vehicleDivider: { height: 1, backgroundColor: '#34584A', marginVertical: 17 },
  vehicleMetrics: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  metricLabel: { color: '#ADC5B5', fontSize: 7, fontWeight: '700', letterSpacing: 0.5 },
  metricValue: { color: c.lime, fontSize: 17, fontWeight: '700', marginTop: 5 },
  emptyGarage: { backgroundColor: c.surface, borderRadius: 22, padding: 22, borderWidth: 1, borderColor: c.line },
  emptyGarageIcon: { backgroundColor: c.softGreen, width: 59, height: 59, borderRadius: 18, alignItems: 'center', justifyContent: 'center', marginBottom: 17 },
  emptyGarageTitle: { color: c.ink, fontSize: 21, fontWeight: '700', letterSpacing: -0.5 },
  emptyGarageText: { color: c.muted, fontSize: 12, lineHeight: 19, marginTop: 8, marginBottom: 20 },
  primaryButton: { minHeight: 49, backgroundColor: c.ink, borderRadius: 14, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 20 },
  primaryButtonText: { color: c.surface, fontWeight: '700', fontSize: 13 },
  pressed: { opacity: 0.72 },
  selectionError: { backgroundColor: c.errorSurface, padding: 14, borderRadius: 14, marginTop: 12 },
  errorText: { color: c.error, fontSize: 11, lineHeight: 17, marginTop: 6 },
  retryButton: { alignSelf: 'flex-start', paddingVertical: 10 },
  chargeCard: { backgroundColor: c.surface, borderRadius: 18, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: c.line, marginTop: 14 },
  chargeIcon: { width: 36, height: 36, backgroundColor: c.softGreen, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  chargeCopy: { flex: 1 },
  chargeTitle: { color: c.ink, fontSize: 12, fontWeight: '700' },
  chargeCaption: { color: c.muted, fontSize: 9, marginTop: 4, lineHeight: 14 },
  chargeInputBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.softGreen, borderRadius: 11, paddingHorizontal: 9, borderWidth: 1, borderColor: c.line },
  invalidInput: { borderColor: c.error },
  percent: { color: c.muted, fontSize: 11 },
  chargeInput: { minWidth: 39, textAlign: 'center', color: c.ink, fontSize: 19, fontWeight: '700', paddingVertical: 9 },
  comingSoon: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22, backgroundColor: '#EAF0E4', padding: 15, borderRadius: 16 },
  comingIcon: { width: 35, height: 35, borderRadius: 11, backgroundColor: '#DDE8D5', alignItems: 'center', justifyContent: 'center' },
  comingCopy: { flex: 1 },
  comingTitle: { color: c.green, fontSize: 12, fontWeight: '700' },
  comingText: { color: c.muted, fontSize: 10, lineHeight: 16, marginTop: 4 },
  footerWordmark: { color: '#9AA592', fontSize: 8, fontWeight: '700', textAlign: 'center', letterSpacing: 1.5, marginTop: 26 },
  stationEmpty: { flex: 1, justifyContent: 'center', paddingHorizontal: 30, paddingBottom: 35 },
  stationIcon: { width: 82, height: 82, borderRadius: 28, backgroundColor: c.softGreen, justifyContent: 'center', alignItems: 'center', marginBottom: 27 },
  stationKicker: { color: c.orange, fontSize: 10, fontWeight: '800', letterSpacing: 2, marginBottom: 14 },
  stationTitle: { color: c.ink, fontSize: 34, lineHeight: 40, fontWeight: '800', letterSpacing: -1 },
  stationText: { color: c.muted, fontSize: 13, lineHeight: 21, marginTop: 15, maxWidth: 300 },
  soonBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, backgroundColor: c.softGreen, borderRadius: 9, marginTop: 22 },
  soonText: { color: c.green, fontWeight: '800', fontSize: 8, letterSpacing: 1.5 },
  navigation: { flexDirection: 'row', backgroundColor: c.surface, borderTopWidth: 1, borderColor: c.line, paddingTop: 10, paddingBottom: 8 },
  navItem: { flex: 1, alignItems: 'center', gap: 4 },
  navIcon: { minWidth: 59, height: 32, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  navIconActive: { backgroundColor: c.lime },
  navLabel: { color: c.muted, fontSize: 9, fontWeight: '600' },
  navLabelActive: { color: c.ink, fontWeight: '800' },
});
