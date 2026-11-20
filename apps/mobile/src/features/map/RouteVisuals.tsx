import {useEffect,useRef,useState} from 'react';
import type {ReactNode} from 'react';
import {AccessibilityInfo,Animated,StyleSheet,Text,View} from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import {Polyline} from 'react-native-maps';
import type {Coordinate,PlannedChargingStop} from '@chargeroad/shared';
import {colors as c} from '../../theme';

function useReducedMotion(){
  const [reduced,setReduced]=useState(true);
  useEffect(()=>{let live=true;void AccessibilityInfo.isReduceMotionEnabled().then(value=>{if(live)setReduced(value);}).catch(()=>{});
    const listener=AccessibilityInfo.addEventListener('reduceMotionChanged',setReduced);
    return()=>{live=false;listener.remove();};},[]);
  return reduced;
}

/** Route reveal: drawn in 18 steps (~0.8 s). loop (plan preview, 2026-11-20 user request): after a ~1.6 s hold the reveal repeats;
 *  no state change while holding. Reduced motion shows the full line without animation. */
export const ROUTE_REVEAL={steps:18,stepMs:45,holdMs:1600} as const;
export function RouteLine({coordinates,loop=false}:{coordinates:Coordinate[];loop?:boolean}){
  const reduced=useReducedMotion(),[count,setCount]=useState(coordinates.length);
  useEffect(()=>{if(reduced){setCount(coordinates.length);return;}
    const {steps,stepMs,holdMs}=ROUTE_REVEAL,hold=Math.round(holdMs/stepMs);let step=0;setCount(2);
    const timer=setInterval(()=>{step++;
      if(step<=steps)setCount(Math.max(2,Math.ceil(coordinates.length*step/steps)));
      else if(!loop)clearInterval(timer);
      else if(step>=steps+hold){step=0;setCount(2);}},stepMs);
    return()=>clearInterval(timer);
  },[coordinates,reduced,loop]);
  return <>
    <Polyline coordinates={coordinates} strokeColor="#FFFFFF" strokeWidth={12} lineCap="round" lineJoin="round"/>
    <Polyline coordinates={coordinates} strokeColor="#133E34" strokeWidth={8} lineCap="round" lineJoin="round"/>
    <Polyline coordinates={coordinates.slice(0,count)} strokeColor="#52D6A0" strokeWidth={4} lineCap="round" lineJoin="round"/>
  </>;
}

export function RouteHighlight({title,subtitle,children}:{title:string;subtitle?:string;children?:ReactNode}){
  const reduced=useReducedMotion(),progress=useRef(new Animated.Value(1)).current;
  useEffect(()=>{if(reduced){progress.setValue(1);return;}
    progress.setValue(0);const animation=Animated.timing(progress,{toValue:1,duration:500,useNativeDriver:true});animation.start();
    return()=>animation.stop();},[reduced,progress]);
  return <Animated.View style={[s.highlight,{opacity:progress,transform:[{translateY:progress.interpolate({inputRange:[0,1],outputRange:[8,0]})}]}]}>
    <View style={s.highlightRow}><View style={s.routeIcon}><Ionicons name="navigate" size={22} color={c.lime}/></View>
      <View style={s.flex}><Text style={s.eyebrow}>CHARGEROAD · ROTA</Text><Text style={s.highlightTitle}>{title}</Text>{subtitle&&<Text style={s.highlightSubtitle}>{subtitle}</Text>}</View>
      <Ionicons name="checkmark-circle" size={23} color={c.lime}/>
    </View>{children}
  </Animated.View>;
}

export function ChargingStopSummary({stop}:{stop:PlannedChargingStop}){
  return <View testID="charging-stop-summary" style={s.summary}>
    <View style={s.highlightRow}><View style={s.routeIcon}><Ionicons name="flash" size={22} color={c.lime}/></View>
      <View style={s.flex}><Text style={s.eyebrow}>PLANLANAN ŞARJ MOLASI</Text><Text style={s.highlightTitle}>{Math.ceil(stop.chargingDurationSeconds/60)} dk şarj</Text></View></View>
    <View style={s.socRow}><View><Text style={s.highlightSubtitle}>Varış şarjı</Text><Text style={s.soc}>%{Math.round(stop.arrivalChargePercent)}</Text></View>
      <Ionicons name="arrow-forward" size={24} color={c.lime}/><View><Text style={s.highlightSubtitle}>Hedef şarj</Text><Text style={[s.soc,{color:c.lime}]}>%{Math.round(stop.targetChargePercent)}</Text></View></View>
    <View accessible accessibilityLabel={`Varış yüzde ${Math.round(stop.arrivalChargePercent)}, hedef yüzde ${Math.round(stop.targetChargePercent)}`} style={s.battery}>
      <View style={[s.batteryTarget,{width:`${stop.targetChargePercent}%`}]}/><View style={[s.batteryArrival,{width:`${stop.arrivalChargePercent}%`}]}/>
    </View>
    <View style={s.facts}><Text style={s.fact}>{stop.energyStoredKwh.toFixed(1)} kWh bataryaya</Text><Text style={s.fact}>{Math.ceil(stop.connectionDurationSeconds/60)} dk bağlantı</Text></View>
    {stop.blockingPreconditioningSeconds>0&&<Text style={s.highlightSubtitle}>Ek batarya hazırlığı: {Math.ceil(stop.blockingPreconditioningSeconds/60)} dk</Text>}
    <Text style={s.highlightSubtitle}>Tahmini sürelerdir. {stop.waiting.seconds===null?'Bekleme süresi bilinmiyor; kesin varış saati verilemiyor.':`Planın bekleme varsayımı: ${Math.ceil(stop.waiting.seconds/60)} dk.`}</Text>
  </View>;
}
const s=StyleSheet.create({flex:{flex:1},highlight:{backgroundColor:c.ink,borderRadius:20,padding:17,gap:12},highlightRow:{flexDirection:'row',alignItems:'center',gap:12},
  routeIcon:{width:44,height:44,borderRadius:15,backgroundColor:'#315A49',alignItems:'center',justifyContent:'center'},eyebrow:{color:c.lime,fontSize:9,fontWeight:'800',letterSpacing:1},
  highlightTitle:{color:'white',fontSize:19,fontWeight:'800',marginTop:4},highlightSubtitle:{color:'#D6E5DC',fontSize:12,lineHeight:19,marginTop:3},
  summary:{backgroundColor:c.ink,borderRadius:22,padding:19,marginTop:18,gap:14},socRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},soc:{fontSize:32,fontWeight:'800',color:'white',letterSpacing:-1},
  battery:{height:10,backgroundColor:'#456455',borderRadius:5,overflow:'hidden'},batteryTarget:{height:10,backgroundColor:c.lime,position:'absolute'},batteryArrival:{height:10,backgroundColor:'#62B698',position:'absolute'},
  facts:{flexDirection:'row',gap:8,flexWrap:'wrap'},fact:{color:'white',backgroundColor:'#315A49',paddingHorizontal:10,paddingVertical:7,borderRadius:10,fontSize:12,fontWeight:'600'}});
