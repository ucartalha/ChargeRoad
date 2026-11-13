import Ionicons from '@expo/vector-icons/Ionicons';
import {StatusBar} from 'expo-status-bar';
import {useCallback,useState} from 'react';
import {ActivityIndicator,Linking,Modal,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {SafeAreaProvider,SafeAreaView,useSafeAreaInsets} from 'react-native-safe-area-context';
import {VehiclesScreen} from './src/features/vehicles/VehiclesScreen';
import {useActiveVehicle} from './src/features/vehicles/useActiveVehicle';
import {variantLabel} from './src/features/vehicles/format';
import {PlanningForm} from './src/features/planning/PlanningForm';
import {MapCanvas} from './src/features/map/MapCanvas';
import type {MapState} from './src/features/map/MapCanvas';
import {RouteSheet} from './src/features/map/RouteSheet';
import {colors as c} from './src/theme';
export default function App(){return <SafeAreaProvider><ChargeRoad/></SafeAreaProvider>;}
function ChargeRoad(){
  const insets=useSafeAreaInsets(),selection=useActiveVehicle();
  const [expanded,setExpanded]=useState(false),[profile,setProfile]=useState(false),[vehicles,setVehicles]=useState(false),[fromPlan,setFromPlan]=useState(false);
  const [mapState,setMapState]=useState<MapState>({origin:null,destination:null,geometry:[],stops:[]});
  const onMapChange=useCallback((next:MapState)=>setMapState(next),[]);
  function chooseVehicle(required=false){setFromPlan(required);setProfile(false);setVehicles(true);}
  return <View style={s.screen}>
    <StatusBar style="dark"/>
    <MapCanvas state={mapState} onOpenNavigation={()=>setExpanded(true)}/>
    <View pointerEvents="box-none" style={[s.header,{paddingTop:insets.top+10}]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Harita ana ekranı" onPress={()=>setExpanded(false)} style={s.brand}>
        <View style={s.mark}><Ionicons name="flash" size={19} color={c.lime}/></View><Text style={s.brandText}>chargeroad<Text style={{color:c.orange}}>.</Text></Text>
      </Pressable>
      <Pressable testID="profile-button" accessibilityRole="button" accessibilityLabel="Profil" onPress={()=>setProfile(true)} style={s.avatar}><Ionicons name="person-outline" size={20} color={c.green}/></Pressable>
    </View>
    <RouteSheet expanded={expanded} onExpand={setExpanded}>
      {!expanded&&<View style={s.peek}>
        <Pressable testID="open-route-planner" accessibilityRole="button" accessibilityLabel="Rota planlamayı aç" onPress={()=>setExpanded(true)} style={s.search}>
          <Ionicons name="search-outline" size={20} color={c.green}/><Text style={s.searchText}>Bir yer veya adres ara</Text><View style={s.routeBadge}><Ionicons name="navigate" size={17} color={c.green}/></View>
        </Pressable>
        <Text style={s.peekCaption}>{selection.vehicle?`${selection.vehicle.make} ${selection.vehicle.model} · Yolculuğa hazır`:'Haritayı keşfet. Araç seçimini rota başlatırken yapabilirsin.'}</Text>
      </View>}
      <ScrollView style={[s.scroll,!expanded&&{display:'none'}]} contentContainerStyle={{paddingHorizontal:20,paddingBottom:insets.bottom+35}} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <PlanningForm vehicle={selection.vehicle} active={expanded&&!vehicles&&!profile} onRequireVehicle={()=>chooseVehicle(true)} onMapChange={onMapChange}/>
        {selection.error&&<View style={s.error}><Text style={s.errorText}>{selection.error}</Text><Pressable accessibilityRole="button" onPress={()=>void selection.retry()}><Text style={s.action}>Tekrar dene</Text></Pressable></View>}
      </ScrollView>
    </RouteSheet>
    <Modal visible={profile} transparent animationType="slide" onRequestClose={()=>setProfile(false)}>
      <View style={s.modalRoot}><Pressable accessibilityLabel="Profili kapat" onPress={()=>setProfile(false)} style={StyleSheet.absoluteFill}/>
        <SafeAreaView edges={['bottom']} style={s.profile}>
          <View style={s.modalHeader}><Text style={s.modalTitle}>Profilin</Text><Pressable accessibilityRole="button" accessibilityLabel="Profili kapat" onPress={()=>setProfile(false)} style={s.close}><Ionicons name="close" size={21} color={c.green}/></Pressable></View>
          <View style={s.identity}><View style={s.identityIcon}><Ionicons name="person-outline" size={27} color={c.green}/></View><View><Text style={s.identityTitle}>Misafir olarak keşfet</Text><Text style={s.caption}>Hesap açmadan rota planlayabilirsin.</Text></View></View>
          <Text style={s.sectionLabel}>BU CİHAZDAKİ ARACIN</Text>
          {selection.loading?<ActivityIndicator color={c.green}/>:<Pressable testID="profile-vehicle-selector" accessibilityRole="button" onPress={()=>chooseVehicle()} style={s.vehicle}>
            <Ionicons name="car-sport-outline" size={29} color={c.green}/><View style={{flex:1}}><Text style={s.vehicleTitle}>{selection.vehicle?`${selection.vehicle.make} ${selection.vehicle.model}`:'Araç seç'}</Text>
              <Text style={s.caption}>{selection.vehicle?`${variantLabel(selection.vehicle)} · ${selection.vehicle.modelYear}`:'Marka, model ve varyantını belirle'}</Text></View><Ionicons name="chevron-forward" size={18} color={c.muted}/>
          </Pressable>}
          <Text style={s.privacy}>Seçimin bu cihazda saklanır. Hesapsız kullanımda sunucu garajı veya seyahat geçmişi oluşturulmaz.</Text>
          <View style={s.credits}><Text style={s.sectionLabel}>VERİ KAYNAKLARI</Text>
            <Pressable accessibilityRole="link" onPress={()=>void Linking.openURL('https://github.com/KilowattApp/open-ev-data')}><Text style={s.caption}>Open EV Data · MIT with Attribution Requirement ↗</Text></Pressable>
            <Pressable accessibilityRole="link" onPress={()=>void Linking.openURL('https://github.com/open-ev-data/open-ev-data-dataset')}><Text style={s.caption}>OpenEV Data · CDLA-Permissive-2.0 ↗</Text></Pressable>
            <Text style={s.caption}>Yaklaşık profiller ChargeRoad mühendislik modelleridir.</Text>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
    <Modal visible={vehicles} animationType="slide" onRequestClose={()=>setVehicles(false)}>
      <SafeAreaView style={s.vehicleModal}>
        <View style={s.modalHeader}><View><Text style={s.modalTitle}>Yol arkadaşını seç</Text><Text style={s.caption}>Marka → model → varyant</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Araç seçimini kapat" onPress={()=>setVehicles(false)} style={s.close}><Ionicons name="close" size={22} color={c.green}/></Pressable></View>
        <VehiclesScreen activeVehicle={selection.vehicle} onSelect={async next=>{await selection.select(next);setVehicles(false);if(fromPlan)setExpanded(true);}}/>
      </SafeAreaView>
    </Modal>
  </View>;
}
const s=StyleSheet.create({screen:{flex:1,backgroundColor:'#DEE8E0'},header:{position:'absolute',top:0,left:0,right:0,paddingHorizontal:18,flexDirection:'row',justifyContent:'space-between',alignItems:'center'},
  brand:{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:'white',padding:7,paddingRight:14,borderRadius:24,elevation:3,shadowColor:'#12382A',shadowOpacity:.08,shadowRadius:8},mark:{width:31,height:31,borderRadius:16,backgroundColor:c.green,alignItems:'center',justifyContent:'center'},brandText:{color:c.ink,fontSize:19,fontWeight:'800',letterSpacing:-1},avatar:{width:45,height:45,borderRadius:23,backgroundColor:'white',alignItems:'center',justifyContent:'center',elevation:3},
  peek:{paddingHorizontal:22,gap:13},search:{minHeight:53,borderWidth:1,borderColor:c.line,backgroundColor:'white',borderRadius:18,paddingHorizontal:14,flexDirection:'row',gap:10,alignItems:'center'},searchText:{color:c.muted,fontSize:14,flex:1},routeBadge:{backgroundColor:c.softGreen,padding:9,borderRadius:11},peekCaption:{color:c.muted,fontSize:10,lineHeight:16},scroll:{flex:1},
  modalRoot:{flex:1,backgroundColor:'#10241C66',justifyContent:'flex-end'},profile:{backgroundColor:c.background,borderTopLeftRadius:30,borderTopRightRadius:30,padding:24,gap:20},modalHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingBottom:8},modalTitle:{color:c.ink,fontSize:22,fontWeight:'800',letterSpacing:-.6},close:{backgroundColor:'#E7EDE7',borderRadius:20,padding:9},identity:{flexDirection:'row',alignItems:'center',gap:13},identityIcon:{backgroundColor:c.softGreen,borderRadius:20,padding:15},identityTitle:{color:c.ink,fontWeight:'700',fontSize:16},caption:{color:c.muted,fontSize:11,lineHeight:18},sectionLabel:{fontSize:9,fontWeight:'800',color:c.muted,letterSpacing:1.2},vehicle:{backgroundColor:'white',borderRadius:18,padding:17,flexDirection:'row',alignItems:'center',gap:13},vehicleTitle:{color:c.green,fontSize:15,fontWeight:'700'},privacy:{color:c.muted,fontSize:11,lineHeight:18},credits:{borderTopWidth:1,borderColor:c.line,paddingTop:15,gap:6},vehicleModal:{flex:1,backgroundColor:c.background,paddingHorizontal:18},error:{backgroundColor:c.errorSurface,padding:13,borderRadius:12,gap:7},errorText:{color:c.error,fontSize:12},action:{color:c.green,fontWeight:'700'}});
